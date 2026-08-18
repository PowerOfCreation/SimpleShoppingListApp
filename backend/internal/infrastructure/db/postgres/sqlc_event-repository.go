package postgres

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

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
) (bool, int64, *uuid.UUID, error) {
	row, err := r.queries.InsertEvent(ctx, db.InsertEventParams{
		ID:            event.EventID,
		EventType:     event.EventType,
		AggregateID:   event.AggregateID,
		AggregateType: event.AggregateType,
		ListID:        pgtypeFromUUIDPtr(event.ListID),
		Payload:       []byte(event.Payload),
		OccurredAt:    timestamptzFromTime(event.OccurredAt),
		ClientID:      event.ClientID,
		UserID:        pgtypeTextFromString(event.UserID),
	})
	if err != nil {
		return false, 0, nil, err
	}
	// InsertEvent upserts (ON CONFLICT DO UPDATE SET id = events.id) purely
	// so RETURNING always yields a row, whether this was a fresh insert or
	// a duplicate delivery of the same event_id. processed_at reflects
	// what's currently stored either way, without a second round-trip.
	return row.ProcessedAt.Valid, row.Seq.Int64, uuidPtrFromPgtype(row.ListID), nil
}

func (r *SqlcEventRepository) MarkProcessed(
	ctx context.Context,
	eventID uuid.UUID,
) error {
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
			ListID:        uuidPtrFromPgtype(row.ListID),
			Payload:       json.RawMessage(row.Payload),
			OccurredAt:    timeFromTimestamptz(row.OccurredAt),
			ClientID:      row.ClientID,
			Seq:           row.Seq.Int64,
			UserID:        stringFromPgtypeText(row.UserID),
		}
	}
	return events, nil
}

func (r *SqlcEventRepository) FindKnownEventIDsByList(
	ctx context.Context,
	listIDs []uuid.UUID,
) ([]uuid.UUID, error) {
	return r.queries.GetKnownEventIdsByList(ctx, listIDs)
}

func (r *SqlcEventRepository) FindListHeads(
	ctx context.Context,
	listIDs []uuid.UUID,
) ([]*repositories.ListHead, error) {
	rows, err := r.queries.GetListHeads(ctx, listIDs)
	if err != nil {
		return nil, err
	}

	heads := make([]*repositories.ListHead, len(rows))
	for i, row := range rows {
		heads[i] = &repositories.ListHead{
			ListID:  uuid.UUID(row.ListID.Bytes),
			Seq:     row.Seq.Int64,
			EventID: row.ID,
		}
	}
	return heads, nil
}

func (r *SqlcEventRepository) FindEventsSince(
	ctx context.Context,
	listID uuid.UUID,
	sinceSeq int64,
	limit int32,
) ([]*repositories.StoredEvent, error) {
	rows, err := r.queries.GetEventsSince(ctx, db.GetEventsSinceParams{
		ListID:     pgtypeFromUUIDPtr(&listID),
		SinceSeq:   pgtype.Int8{Int64: sinceSeq, Valid: true},
		LimitCount: limit,
	})
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
			ListID:        uuidPtrFromPgtype(row.ListID),
			Payload:       json.RawMessage(row.Payload),
			OccurredAt:    timeFromTimestamptz(row.OccurredAt),
			ClientID:      row.ClientID,
			Seq:           row.Seq.Int64,
		}
	}
	return events, nil
}
