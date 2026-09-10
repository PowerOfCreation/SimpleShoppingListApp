import { getSyncDetails, reportSyncStarted } from "../sync-status"

it("clears a syncing state whose finish() never arrives", () => {
  jest.useFakeTimers()
  try {
    reportSyncStarted()
    expect(getSyncDetails().status).toBe("syncing")
    jest.runOnlyPendingTimers()
    expect(getSyncDetails().status).toBe("error")
    // A fresh pass afterwards must not itself get stuck.
    const { finish } = reportSyncStarted()
    finish(true)
    expect(getSyncDetails().status).toBe("synced")
  } finally {
    jest.useRealTimers()
  }
})

it("does not fire while progress keeps being reported, however long the whole pass runs", () => {
  jest.useFakeTimers()
  try {
    const { finish, progress } = reportSyncStarted()
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(25_000)
      progress()
    }
    expect(getSyncDetails().status).toBe("syncing")
    finish(true)
    expect(getSyncDetails().status).toBe("synced")
  } finally {
    jest.useRealTimers()
  }
})

it("ignores a straggler finish() for the exact pass the watchdog already gave up on, rather than resurrecting it", () => {
  jest.useFakeTimers()
  try {
    const { finish } = reportSyncStarted()
    jest.runOnlyPendingTimers()
    expect(getSyncDetails().status).toBe("error")
    // The original request finally settles after the watchdog already
    // cleared it - must not flip "error" back to "synced" as if a real
    // sync had just succeeded.
    finish(true)
    expect(getSyncDetails().status).toBe("error")
  } finally {
    jest.useRealTimers()
  }
})

it("ignores a straggler finish() from an abandoned pass without corrupting the pass that started after it", () => {
  jest.useFakeTimers()
  try {
    const staleFinish = reportSyncStarted().finish
    jest.runOnlyPendingTimers()
    expect(getSyncDetails().status).toBe("error")

    const freshFinish = reportSyncStarted().finish
    expect(getSyncDetails().status).toBe("syncing")

    // The abandoned pass's request finally settles after a real new pass
    // has already started - must not finalize (or fail) that new pass out
    // from under it.
    staleFinish(true)
    expect(getSyncDetails().status).toBe("syncing")

    freshFinish(true)
    expect(getSyncDetails().status).toBe("synced")
  } finally {
    jest.useRealTimers()
  }
})

it("keeps the previous success when a nested flush succeeds but the pull fails", () => {
  reportSyncStarted().finish(true)
  const previousSuccess = getSyncDetails().lastSuccessAt

  const outerFinish = reportSyncStarted().finish
  const attempt = getSyncDetails().lastAttemptAt
  const innerFinish = reportSyncStarted().finish
  innerFinish(true)
  expect(getSyncDetails().status).toBe("syncing")
  outerFinish(false)
  expect(getSyncDetails()).toEqual({
    status: "error",
    lastAttemptAt: attempt,
    lastSuccessAt: previousSuccess,
    error: expect.any(String),
  })

  reportSyncStarted().finish(true)
  expect(getSyncDetails().error).toBeNull()
})

it("expires a stalled operation even while independent operations keep succeeding", () => {
  jest.useFakeTimers()
  try {
    const stalled = reportSyncStarted()
    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(9_000)
      const other = reportSyncStarted()
      other.progress()
      // At expiry the old pass must have retired its own count, so a fresh
      // successful operation can complete instead of staying syncing forever.
      other.finish(true)
    }
    expect(getSyncDetails().status).toBe("synced")
    stalled.finish(false)
    expect(getSyncDetails().status).toBe("synced")
  } finally {
    jest.useRealTimers()
  }
})
