import { SQLiteDatabase } from "expo-sqlite"
import { BaseRepository } from "./base-repository"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

/**
 * Whether *this device* syncs a given list - a device-local setting, not a
 * fact derivable from the (server-mergeable) event log. Deliberately its
 * own table rather than a column on ingredient_lists, for the same reason
 * sync_cursors is its own table (see sync-cursor-repository.ts): that table
 * is a projection whose rebuild does `DELETE FROM ingredient_lists` first,
 * which would silently reset a co-located flag to its default on every
 * rebuild - exactly the bug migration-7 repairs. Never populated by a
 * projection rebuild, never sent to or read from the server.
 */
export class ListSyncSettingsRepository extends BaseRepository {
  protected readonly entityName = "ListSyncSettings"

  constructor(db: SQLiteDatabase) {
    super(db, "ListSyncSettingsRepository")
  }

  /** Ids of every list this device currently syncs - drives pull/reconcile/subscribe (see SyncCoordinator). */
  async getEnabledIds(): Promise<Result<string[], DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{ list_id: string }>(
        `SELECT list_id FROM list_sync_settings WHERE enabled = 1`
      )
      return result.map((row) => row.list_id)
    }, "getEnabledIds")
  }

  async isEnabled(listId: string): Promise<Result<boolean, DbQueryError>> {
    return this._executeQuery(async () => {
      const row = await this.db.getFirstAsync<{ enabled: number }>(
        `SELECT enabled FROM list_sync_settings WHERE list_id = ?`,
        listId
      )
      return row?.enabled === 1
    }, "isEnabled")
  }

  async setEnabled(
    listId: string,
    enabled: boolean
  ): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.setEnabledWithin(this.db, listId, enabled)
    }, "setEnabled")
  }

  /**
   * Same upsert as setEnabled(), but against a caller-supplied `db` handle
   * and without opening its own transaction - for callers that need this to
   * commit atomically with other writes (e.g. ShoppingListService enqueuing
   * the list's history for sync in the same transaction as the toggle).
   */
  async setEnabledWithin(
    db: SQLiteDatabase,
    listId: string,
    enabled: boolean
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO list_sync_settings (list_id, enabled, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(list_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      listId,
      enabled ? 1 : 0,
      Date.now()
    )
  }

  async remove(listId: string): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.removeWithin(this.db, listId)
    }, "remove")
  }

  async removeWithin(db: SQLiteDatabase, listId: string): Promise<void> {
    await db.runAsync(
      `DELETE FROM list_sync_settings WHERE list_id = ?`,
      listId
    )
  }
}
