import { SQLiteDatabase } from "expo-sqlite"
import { BaseRepository } from "./base-repository"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

export type OutboxStatus = "pending" | "synced"

export type OutboxRow = {
  event_id: string
  aggregate_id: string
  status: OutboxStatus
  attempts: number
  last_attempt_at: number | null
  created_at: number
}

/**
 * Tracks which domain events still need to reach the backend.
 *
 * There is deliberately no "sent"/"in-flight" status persisted here: a row
 * that gets marked "sent" after the 202 response and then never receives
 * its ack (app killed, server crashed before commit, response lost) would
 * have no way back to "pending" on its own. Instead there are only two
 * persisted states, "pending" and "synced" - the sync engine keeps its own
 * in-memory set of event ids currently in flight, which is naturally
 * cleared on restart, making every in-flight row "pending" again. Because
 * the server's insert is idempotent (ON CONFLICT DO NOTHING on event_id), a
 * duplicate resend after a restart is harmless.
 */
export class OutboxRepository extends BaseRepository {
  protected readonly entityName = "EventOutbox"

  constructor(db: SQLiteDatabase) {
    super(db, "OutboxRepository")
  }

  /**
   * Enqueues an outbox row on the given `db` handle. Callers running inside
   * an existing transaction (EventRepository.appendAll) must pass that
   * transaction's `db` so the outbox insert commits atomically with the
   * event insert and its projection - never call this outside of one of
   * those callbacks, since it does not open its own transaction.
   *
   * `INSERT OR IGNORE`: enqueueing an event_id that's already queued (e.g.
   * turning sync on for a list more than once, which replays its whole
   * history into the outbox each time) is a harmless no-op, not an error.
   */
  async enqueue(
    db: SQLiteDatabase,
    eventId: string,
    aggregateId: string,
    createdAt: number
  ): Promise<void> {
    await db.runAsync(
      `INSERT OR IGNORE INTO event_outbox (event_id, aggregate_id, status, attempts, last_attempt_at, created_at)
       VALUES (?, ?, 'pending', 0, NULL, ?)`,
      eventId,
      aggregateId,
      createdAt
    )
  }

  /**
   * Returns up to `limit` pending rows, oldest first. Pass `after` (the
   * event_id of the last row from a previous page) to keyset-paginate
   * through everything pending instead of only ever seeing the same first
   * page - the sync engine's drain loop uses this to send an unbounded
   * backlog a bounded batch at a time (see sync-engine.ts).
   *
   * The keyset itself is (created_at, rowid), matching this table's index
   * and the ORDER BY below - rowid rather than event_id because event_id is
   * a random uuid and wouldn't preserve insertion order for two rows that
   * share a created_at (created_at is the *event's* occurred_at, not the
   * enqueue time, so same-millisecond ties happen for events emitted back
   * to back). Looked up via a row-value subquery (`(created_at, rowid) >
   * (SELECT ...)`, supported since SQLite 3.15) rather than accepting a raw
   * rowid parameter, so OutboxRow's public shape never has to expose rowid
   * at all.
   *
   * If `after`'s row no longer exists (e.g. cancelForList raced the drain
   * loop and removed it), the subquery returns no row and the comparison
   * is NULL for every candidate - this page comes back empty rather than
   * resuming from the wrong place. Harmless: the next unrelated trigger
   * calls getPending() from the start again.
   */
  async getPending(
    limit: number = 50,
    after?: string
  ): Promise<Result<OutboxRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      if (after) {
        return this.db.getAllAsync<OutboxRow>(
          `SELECT event_id, aggregate_id, status, attempts, last_attempt_at, created_at
           FROM event_outbox
           WHERE status = 'pending'
             AND (created_at, rowid) > (
               SELECT created_at, rowid FROM event_outbox WHERE event_id = ?
             )
           ORDER BY created_at ASC, rowid ASC
           LIMIT ?`,
          after,
          limit
        )
      }
      return this.db.getAllAsync<OutboxRow>(
        `SELECT event_id, aggregate_id, status, attempts, last_attempt_at, created_at
         FROM event_outbox
         WHERE status = 'pending'
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
        limit
      )
    }, "getPending")
  }

  /**
   * Marks a row as synced. A no-op (not an error) when the row is already
   * gone: an ack can race a toggle-sync-off that already deleted the
   * pending row via cancelForList, and that must not surface as a
   * failure.
   */
  async markSynced(eventId: string): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE event_outbox SET status = 'synced' WHERE event_id = ?`,
        eventId
      )
    }, "markSynced")
  }

  async bumpAttempt(
    eventId: string,
    attemptedAt: number
  ): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE event_outbox SET attempts = attempts + 1, last_attempt_at = ? WHERE event_id = ?`,
        attemptedAt,
        eventId
      )
    }, "bumpAttempt")
  }

  /**
   * Used by reconcile: rows we believe are synced but the server has no
   * record of go back to pending so they get resent (the self-heal path).
   */
  async resetToPending(
    eventIds: string[]
  ): Promise<Result<void, DbQueryError>> {
    if (eventIds.length === 0) {
      return Result.ok(undefined)
    }
    return this._executeTransaction(async () => {
      const placeholders = eventIds.map(() => "?").join(", ")
      await this.db.runAsync(
        `UPDATE event_outbox SET status = 'pending' WHERE event_id IN (${placeholders})`,
        ...eventIds
      )
    }, "resetToPending")
  }

  /**
   * Cancels every still-pending outbox row belonging to a list - its own
   * todo_list.* rows (aggregate_id = listId) as well as every ingredient.*
   * row for ingredients in that list. Used when sync is turned off for a
   * list: the server's existing copy (if any) is left alone, only the
   * local intent to send more is cleared.
   *
   * Joins through domain_events.list_id rather than a denormalized list_id
   * on event_outbox itself - every outbox row is always backed by a
   * domain_events row (see EventRepository.appendAll/enqueueExistingForSync),
   * so there's nothing a second copy of the column would buy beyond a join.
   */
  async cancelForList(listId: string): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `DELETE FROM event_outbox
         WHERE status = 'pending'
           AND event_id IN (SELECT event_id FROM domain_events WHERE list_id = ?)`,
        listId
      )
    }, "cancelForList")
  }
}
