import { SQLiteDatabase } from "expo-sqlite"
import { BaseRepository } from "./base-repository"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

export type SyncCursorRow = {
  list_id: string
  last_seen_seq: number
  last_pulled_at: number | null
}

/**
 * Tracks, per sync-enabled list, the last server seq we've pulled up to -
 * the cursor the pull decision table (SyncEngine.pull) compares against
 * the server's head. Deliberately its own table rather than a column on
 * ingredient_lists: that table is a projection whose rebuild() does
 * `DELETE FROM ingredient_lists` first, which would silently reset a
 * co-located cursor to nothing on every rebuild and force a full re-pull -
 * the same class of bug the ingredient_lists.sync_enabled column already
 * had to be guarded against (see ingredient-list-projection.ts).
 */
export class SyncCursorRepository extends BaseRepository {
  protected readonly entityName = "SyncCursor"

  constructor(db: SQLiteDatabase) {
    super(db, "SyncCursorRepository")
  }

  async get(
    listId: string
  ): Promise<Result<SyncCursorRow | null, DbQueryError>> {
    return this._executeQuery(async () => {
      const row = await this.db.getFirstAsync<SyncCursorRow>(
        `SELECT list_id, last_seen_seq, last_pulled_at FROM sync_cursors WHERE list_id = ?`,
        listId
      )
      return row ?? null
    }, "get")
  }

  async getAll(): Promise<Result<SyncCursorRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<SyncCursorRow>(
        `SELECT list_id, last_seen_seq, last_pulled_at FROM sync_cursors`
      )
    }, "getAll")
  }

  async set(
    listId: string,
    seq: number,
    pulledAt: number
  ): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.setWithin(this.db, listId, seq, pulledAt)
    }, "set")
  }

  /**
   * Same upsert as set(), but against a caller-supplied `db` handle and
   * without opening its own transaction - for use inside an already-open
   * transaction (EventApplier.apply commits the cursor advance atomically
   * with the events it just applied).
   */
  async setWithin(
    db: SQLiteDatabase,
    listId: string,
    seq: number,
    pulledAt: number
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO sync_cursors (list_id, last_seen_seq, last_pulled_at) VALUES (?, ?, ?)
       ON CONFLICT(list_id) DO UPDATE SET last_seen_seq = excluded.last_seen_seq, last_pulled_at = excluded.last_pulled_at`,
      listId,
      seq,
      pulledAt
    )
  }

  async clear(listId: string): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `DELETE FROM sync_cursors WHERE list_id = ?`,
        listId
      )
    }, "clear")
  }
}
