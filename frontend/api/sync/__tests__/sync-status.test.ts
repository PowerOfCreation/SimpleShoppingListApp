import {
  getSyncDetails,
  reportSyncStarted,
  reportSyncFinished,
} from "../sync-status"

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
