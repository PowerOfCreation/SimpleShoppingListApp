import {
  getSyncDetails,
  reportSyncStarted,
  reportSyncFinished,
} from "../sync-status"

it("clears a syncing state whose reportSyncFinished() never arrives", () => {
  jest.useFakeTimers()
  try {
    reportSyncStarted()
    expect(getSyncDetails().status).toBe("syncing")
    jest.runOnlyPendingTimers()
    expect(getSyncDetails().status).toBe("error")
    // A late finish for the abandoned pass must not get stuck itself.
    reportSyncStarted()
    reportSyncFinished(true)
    expect(getSyncDetails().status).toBe("synced")
  } finally {
    jest.useRealTimers()
  }
})

it("keeps the previous success when a nested flush succeeds but the pull fails", () => {
  reportSyncStarted()
  reportSyncFinished(true)
  const previousSuccess = getSyncDetails().lastSuccessAt
  reportSyncStarted()
  const attempt = getSyncDetails().lastAttemptAt
  reportSyncStarted()
  reportSyncFinished(true)
  expect(getSyncDetails().status).toBe("syncing")
  reportSyncFinished(false)
  expect(getSyncDetails()).toEqual({
    status: "error",
    lastAttemptAt: attempt,
    lastSuccessAt: previousSuccess,
    error: expect.any(String),
  })
  reportSyncStarted()
  reportSyncFinished(true)
  expect(getSyncDetails().error).toBeNull()
})
