package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

// transactionBeginner is the one thing AppendToList needs beyond db.DBTX:
// both *pgxpool.Pool (production) and the *pgx.Conn testhelpers.SetupTestDB
// hands out implement it, so this repository works unchanged in either.
type transactionBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

type SqlcEventRepository struct {
	conn    transactionBeginner
	queries *db.Queries
}

func NewSqlcEventRepository(conn transactionBeginner, queries *db.Queries) repositories.EventRepository {
	return &SqlcEventRepository{conn: conn, queries: queries}
}

// AppendToList implements repositories.EventRepository. See that interface
// for the invariant this establishes (row lock -> per-list gapless seq).
func (r *SqlcEventRepository) AppendToList(
	ctx context.Context,
	listID uuid.UUID,
	events []*repositories.StoredEvent,
	now time.Time,
) (int64, bool, error) {
	tx, err := r.conn.Begin(ctx)
	if err != nil {
		return 0, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := r.queries.WithTx(tx)

	headSeq, err := q.LockOrCreateSyncedList(ctx, db.LockOrCreateSyncedListParams{
		ListID:    listID,
		CreatedAt: timestamptzFromTime(now),
	})
	if err != nil {
		return 0, false, err
	}

	appended := false
	for _, event := range events {
		headSeq++
		seq, err := q.InsertEventAtSeq(ctx, db.InsertEventAtSeqParams{
			ID:            event.EventID,
			EventType:     event.EventType,
			AggregateID:   event.AggregateID,
			AggregateType: event.AggregateType,
			ListID:        pgtypeFromUUIDPtr(&listID),
			Payload:       []byte(event.Payload),
			OccurredAt:    timestamptzFromTime(event.OccurredAt),
			ClientID:      event.ClientID,
			Seq:           pgtype.Int8{Int64: headSeq, Valid: true},
			UserID:        pgtypeTextFromString(event.UserID),
		})
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				return 0, false, err
			}
			// event_id already existed (a duplicate delivery, e.g. a
			// retried push after a lost response) - it keeps its original
			// seq, so this iteration's headSeq++ above didn't actually
			// consume a slot.
			headSeq--
			existingSeq, err := q.GetEventSeq(ctx, event.EventID)
			if err != nil {
				return 0, false, err
			}
			event.Seq = existingSeq.Int64
			continue
		}
		event.Seq = seq.Int64
		appended = true
	}

	if appended {
		if err := q.UpdateSyncedListHeadSeq(ctx, db.UpdateSyncedListHeadSeqParams{
			ListID: listID, HeadSeq: headSeq,
		}); err != nil {
			return 0, false, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, false, err
	}
	return headSeq, appended, nil
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
			ListID:  row.ListID,
			Seq:     row.Seq,
			EventID: uuidPtrFromPgtype(row.EventID),
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
