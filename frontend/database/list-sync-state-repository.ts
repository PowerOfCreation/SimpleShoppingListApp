import { SQLiteDatabase } from "expo-sqlite"
import { BaseRepository } from "./base-repository"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

/**
 * Device-local state for a list's sync: whether *this device* syncs it
 * (a setting) and whether the server last rejected it with 403 (a status
 * flag) - neither is a fact derivable from the (server-mergeable) event
 * log. Named list_sync_state rather than list_sync_settings (migration-8)
 * once it started carrying that status flag too, not just a toggle.
 * Deliberately its own table rather than a column on ingredient_lists, for
 * the same reason sync_cursors is its own table (see
 * sync-cursor-repository.ts): that table is a projection whose rebuild does
 * `DELETE FROM ingredient_lists` first, which would silently reset a
 * co-located flag to its default on every rebuild - exactly the bug
 * migration-7 repairs. Never populated by a projection rebuild, never sent
 * to or read from the server.
 */
export class ListSyncStateRepository extends BaseRepository {
  protected readonly entityName = "ListSyncState"

  constructor(db: SQLiteDatabase) {
    super(db, "ListSyncStateRepository")
  }

  /** Ids of every list this device currently syncs - drives pull/reconcile/subscribe (see SyncCoordinator). */
  async getEnabledIds(): Promise<Result<string[], DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{ list_id: string }>(
        `SELECT list_id FROM list_sync_state WHERE enabled = 1`
      )
      return result.map((row) => row.list_id)
    }, "getEnabledIds")
  }

  /**
   * Ids of every list this device has a row for, enabled or not - "has this
   * device ever made a sync decision about this list", as opposed to
   * getEnabledIds()'s "is it on right now". Distinct on purpose: a list the
   * user explicitly turned sync off for (setEnabled(id, false)) keeps its
   * row here so a later discovery pass (SyncCoordinator.discoverLists) can
   * tell "known, deliberately off" apart from "never seen" and only enable
   * the latter - the same row is why a disabled list is invisible to
   * getEnabledIds() without this being ambiguous.
   */
  async getKnownIds(): Promise<Result<string[], DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{ list_id: string }>(
        `SELECT list_id FROM list_sync_state`
      )
      return result.map((row) => row.list_id)
    }, "getKnownIds")
  }

  async isEnabled(listId: string): Promise<Result<boolean, DbQueryError>> {
    return this._executeQuery(async () => {
      const row = await this.db.getFirstAsync<{ enabled: number }>(
        `SELECT enabled FROM list_sync_state WHERE list_id = ?`,
        listId
      )
      return row?.enabled === 1
    }, "isEnabled")
  }

  /**
   * Device-local diagnostic: whether the server last rejected this list
   * with 403 (removed as a member, account switch). Only ever set for a
   * list that's already gone through setEnabled (sync only touches
   * enabled lists), so this is a plain UPDATE, not an upsert.
   */
  async isPermissionDenied(
    listId: string
  ): Promise<Result<boolean, DbQueryError>> {
    return this._executeQuery(async () => {
      const row = await this.db.getFirstAsync<{ permission_denied: number }>(
        `SELECT permission_denied FROM list_sync_state WHERE list_id = ?`,
        listId
      )
      return row?.permission_denied === 1
    }, "isPermissionDenied")
  }

  async setPermissionDenied(
    listId: string,
    denied: boolean
  ): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE list_sync_state SET permission_denied = ? WHERE list_id = ?`,
        denied ? 1 : 0,
        listId
      )
    }, "setPermissionDenied")
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
      `INSERT INTO list_sync_state (list_id, enabled, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(list_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      listId,
      enabled ? 1 : 0,
      Date.now()
    )
  }

  async removeWithin(db: SQLiteDatabase, listId: string): Promise<void> {
    await db.runAsync(`DELETE FROM list_sync_state WHERE list_id = ?`, listId)
  }

  /**
   * Same delete as removeWithin(), opening its own transaction - for callers
   * outside an existing one (e.g. logout, which wants "forget this device
   * ever made a sync decision" rather than "record a decision to turn it
   * off", so a later discoverLists() treats the list as unseen again).
   */
  async remove(listId: string): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.removeWithin(this.db, listId)
    }, "remove")
  }
}
