/**
 * Process-wide write serializer for the SQLite singleton connection.
 *
 * `expo-sqlite`'s `withTransactionAsync` is a bare `BEGIN`/`COMMIT` and is
 * explicitly documented as "not exclusive and can be interrupted by other
 * async queries". Because `getDatabase()` hands out a single connection for
 * the whole app, two overlapping transactions on that connection race: the
 * inner `BEGIN` of the second transaction throws (SQLite only allows one
 * transaction at a time), and the resulting `catch` issues a `ROLLBACK` that
 * rolls back the *other*, still-in-flight transaction's uncommitted work.
 *
 * This used to be harmless because every write was user-initiated and
 * therefore serial in practice. Once background work (sync flush, ack
 * handling, reconcile) can write at the same time as the user, overlap
 * becomes routine. `runExclusive` queues callbacks so at most one write
 * transaction is ever in flight, regardless of how many repositories share
 * the connection.
 *
 * `withExclusiveTransactionAsync` (expo-sqlite's own answer to this) isn't
 * usable here: it requires every query inside the transaction to run on a
 * separate `txn` handle, which would break the `projection(db)` callback
 * shape used throughout `EventRepository`, and it isn't supported on web,
 * which is a build target for this app.
 */

let queue: Promise<void> = Promise.resolve()

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(() => fn())

  // The queue itself must never reject - it's just a "the previous turn is
  // done" signal - otherwise a failed transaction would permanently wedge
  // every later caller behind a rejected promise.
  queue = run.then(
    () => undefined,
    () => undefined
  )

  return run
}
