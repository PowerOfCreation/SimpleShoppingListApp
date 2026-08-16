package services

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

// rebuildBatchSize is the page size RebuildList reads the event log in. Not
// tied to any particular list size limit - just an upper bound on memory
// per round-trip.
const rebuildBatchSize = 500

type ToDoListService struct {
	logger             *slog.Logger
	todoListRepository repositories.ToDoListRepository
	todoListTx         repositories.ToDoListTx
	eventRepository    repositories.EventRepository
}

func NewToDoListService(
	logger *slog.Logger,
	todoListRepository repositories.ToDoListRepository,
	todoListTx repositories.ToDoListTx,
	eventRepository repositories.EventRepository,
) interfaces.ToDoListService {
	return &ToDoListService{
		logger:             logger,
		todoListRepository: todoListRepository,
		todoListTx:         todoListTx,
		eventRepository:    eventRepository,
	}
}

func (s *ToDoListService) CreateToDoList(ctx context.Context, todoListCommand *command.CreateToDoListCommand) (*command.CreateToDoListCommandResult, error) {
	newToDoList := entities.NewToDoListAt(todoListCommand.Id, todoListCommand.Name, todoListCommand.OccurredAt)

	validatedToDoList, err := entities.NewValidatedToDoList(newToDoList)
	if err != nil {
		return nil, err
	}

	if err := s.todoListRepository.Create(ctx, validatedToDoList); err != nil {
		return nil, err
	}

	result := command.CreateToDoListCommandResult{
		Result: mapper.NewToDoListResultFromValidatedEntity(validatedToDoList),
	}

	return &result, nil
}

// UpdateToDoList never reads the row first - todo_lists is a derived
// projection, not the authority, so a missing or already-deleted row is
// never an error (see UpdateToDoList in sql/queries/todo-lists.sql, which
// silently affects zero rows in that case). CreatedAt here is a synthetic
// stand-in purely to satisfy validate(); the UPDATE only ever touches
// name/updated_at, so it never actually reaches storage.
func (s *ToDoListService) UpdateToDoList(ctx context.Context, todoListCommand *command.UpdateToDoListCommand) (*command.UpdateToDoListCommandResult, error) {
	toDoList := entities.NewToDoListAt(todoListCommand.Id, todoListCommand.Name, todoListCommand.OccurredAt)

	validatedToDoList, err := entities.NewValidatedToDoList(toDoList)
	if err != nil {
		return nil, err
	}

	if err := s.todoListRepository.Update(ctx, validatedToDoList); err != nil {
		return nil, err
	}

	result := command.UpdateToDoListCommandResult{
		Result: mapper.NewToDoListResultFromValidatedEntity(validatedToDoList),
	}

	return &result, nil
}

// DeleteToDoList never reads the row first, for the same reason as
// UpdateToDoList: a missing row just means the tombstone lands with no
// prior state to overwrite. The delete itself is idempotent (see
// DeleteToDoList in sql/queries/todo-lists.sql).
func (s *ToDoListService) DeleteToDoList(ctx context.Context, todoListCommand *command.DeleteToDoListCommand) (*command.DeleteToDoListCommandResult, error) {
	if err := s.todoListRepository.Delete(ctx, todoListCommand.Id, todoListCommand.OccurredAt); err != nil {
		return nil, err
	}

	result := command.DeleteToDoListCommandResult{
		Success: true,
	}

	return &result, nil
}

// RebuildList replays a list's full event history, seq-ascending, through
// the same handlers forward application uses, inside a single transaction -
// so a mid-replay failure leaves the previous projection intact rather than
// a half-rebuilt one. Not wired to any route; it's the foundation for the
// unsync endpoint (separate PR).
func (s *ToDoListService) RebuildList(ctx context.Context, listID uuid.UUID) error {
	return s.todoListTx.WithinTx(ctx, func(repo repositories.ToDoListRepository) error {
		// A local dispatcher over a tx-scoped service, not an injected one:
		// EventDispatcher -> handlers -> ToDoListService would otherwise be
		// a construction cycle. ingredient.* events fall through the
		// dispatcher's existing unknown-type no-op, same as forward
		// application - see event-dispatcher.go.
		txService := &ToDoListService{todoListRepository: repo}
		dispatcher := NewEventDispatcher(s.logger,
			NewCreateToDoListEventHandler(txService),
			NewUpdateToDoListEventHandler(txService),
			NewDeleteToDoListEventHandler(txService),
		)

		var cursor int64
		for {
			batch, err := s.eventRepository.FindEventsSince(ctx, listID, cursor, rebuildBatchSize)
			if err != nil {
				return err
			}
			for _, event := range batch {
				if err := dispatcher.Dispatch(ctx, event.EventType, event.AggregateID, event.OccurredAt, event.Payload); err != nil {
					return err
				}
				cursor = event.Seq
			}
			if len(batch) < rebuildBatchSize {
				return nil
			}
		}
	})
}
