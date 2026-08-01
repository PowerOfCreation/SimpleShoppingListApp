package postgres

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

type SqlcEventRepository struct {
	queries *db.Queries
}

func NewSqlcEventRepository(queries *db.Queries) repositories.EventRepository {
	return &SqlcEventRepository{queries: queries}
}

func (r *SqlcEventRepository) Insert(
	ctx context.Context,
	event *repositories.StoredEvent,
) (bool, error) {
	processedAt, err := r.queries.InsertEvent(ctx, db.InsertEventParams{
		ID:            event.EventID,
		EventType:     event.EventType,
		AggregateID:   event.AggregateID,
		AggregateType: event.AggregateType,
		Payload:       []byte(event.Payload),
		OccurredAt:    timestamptzFromTime(event.OccurredAt),
		ClientID:      event.ClientID,
	})
	if err != nil {
		return false, err
	}
	// InsertEvent upserts (ON CONFLICT DO UPDATE SET id = events.id) purely
	// so RETURNING always yields a row, whether this was a fresh insert or
	// a duplicate delivery of the same event_id. processed_at reflects
	// what's currently stored either way, without a second round-trip.
	return processedAt.Valid, nil
}

func (r *SqlcEventRepository) MarkProcessed(ctx context.Context, eventID uuid.UUID) error {
	return r.queries.MarkEventProcessed(ctx, eventID)
}

func (r *SqlcEventRepository) FindUnprocessed(
	ctx context.Context,
) ([]*repositories.StoredEvent, error) {
	rows, err := r.queries.GetUnprocessedEvents(ctx)
	if err != nil {
		return nil, err
	}

	events := make([]*repositories.StoredEvent, len(rows))
	for i, row := range rows {
		events[i] = &repositories.StoredEvent{
			EventID:       row.ID,
			EventType:     row.EventType,
			AggregateID:   row.AggregateID,
			AggregateType: row.AggregateType,
			Payload:       json.RawMessage(row.Payload),
			OccurredAt:    timeFromTimestamptz(row.OccurredAt),
			ClientID:      row.ClientID,
		}
	}
	return events, nil
}

func (r *SqlcEventRepository) FindKnownEventIDs(
	ctx context.Context,
	aggregateIDs []uuid.UUID,
) ([]uuid.UUID, error) {
	return r.queries.GetKnownEventIds(ctx, aggregateIDs)
}
