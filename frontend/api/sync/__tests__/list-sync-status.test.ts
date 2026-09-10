import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { Result } from "@/api/common/result"
import {
  getListSyncStatus,
  startListSync,
  loadListSyncPermission,
  setListPermissionDenied,
  clearListSyncStatus,
} from "../list-sync-status"
jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return { ...originalModule, DB_NAME: ":memory:" }
})
jest.mock("@/database/list-sync-state-repository")

it("isolates lists and keeps upload errors until an upload succeeds", () => {
  startListSync("a", "push").finish(false)
  startListSync("b", "push").finish(true)
  startListSync("a", "pull").finish(true)
  expect(getListSyncStatus("a")).toBe("error")
  expect(getListSyncStatus("b")).toBe("synced")
  const { finish } = startListSync("a", "push")
  expect(getListSyncStatus("a")).toBe("syncing")
  finish(true)
  expect(getListSyncStatus("a")).toBe("synced")
})

it("retains failures across batches and overlapping operations", () => {
  const { finish } = startListSync("batches", "push")
  startListSync("batches", "push").finish(false)
  startListSync("batches", "push").finish(true)
  finish(true)
  expect(getListSyncStatus("batches")).toBe("error")
})

it("does not clear a download failure with an upload", () => {
  startListSync("download", "pull").finish(false)
  startListSync("download", "push").finish(true)
  expect(getListSyncStatus("download")).toBe("error")
  expect(getListSyncStatus("untouched")).toBeUndefined()
})

it("restores permission denial and keeps it through unrelated sync failures", async () => {
  jest
    .mocked(ListSyncStateRepository.prototype.isPermissionDenied)
    .mockResolvedValueOnce(Result.ok(true))
  const setPermissionDenied = jest.mocked(
    ListSyncStateRepository.prototype.setPermissionDenied
  )
  setPermissionDenied.mockResolvedValueOnce(Result.ok(undefined))
  await loadListSyncPermission("persisted")
  expect(getListSyncStatus("persisted")).toBe("forbidden")
  startListSync("persisted", "push").finish(false)
  expect(getListSyncStatus("persisted")).toBe("forbidden")
  await setListPermissionDenied("persisted", false)
  expect(setPermissionDenied).toHaveBeenLastCalledWith("persisted", false)
  expect(getListSyncStatus("persisted")).toBe("error")
})

it("clears a stuck forbidden status once its list_sync_state row is gone (logout, list deletion)", async () => {
  jest
    .mocked(ListSyncStateRepository.prototype.isPermissionDenied)
    .mockResolvedValueOnce(Result.ok(true))
  await loadListSyncPermission("removed")
  expect(getListSyncStatus("removed")).toBe("forbidden")

  clearListSyncStatus("removed")
  expect(getListSyncStatus("removed")).toBeUndefined()

  jest
    .mocked(ListSyncStateRepository.prototype.isPermissionDenied)
    .mockResolvedValueOnce(Result.ok(false))
  await loadListSyncPermission("removed")
  expect(getListSyncStatus("removed")).toBeUndefined()
})

it("clears a pass whose finish() never arrives (e.g. a request frozen by app backgrounding)", () => {
  jest.useFakeTimers()
  try {
    startListSync("stuck", "pull")
    expect(getListSyncStatus("stuck")).toBe("syncing")
    jest.runOnlyPendingTimers()
    expect(getListSyncStatus("stuck")).toBe("error")
  } finally {
    jest.useRealTimers()
  }
})

it("does not fire while progress() keeps proving progress, however long the whole pass runs", () => {
  jest.useFakeTimers()
  try {
    const pass = startListSync("progressing", "pull")
    // Each step alone is under one request's own stale budget, but the
    // total run is comfortably past it - only possible without a false
    // "error" because progress() (called once per completed
    // request/page/batch) keeps pushing the deadline out.
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(25_000)
      pass.progress()
    }
    expect(getListSyncStatus("progressing")).toBe("syncing")
    pass.finish(true)
  } finally {
    jest.useRealTimers()
  }
})

it("still fires once progress stops being reported, even after earlier touches kept the pass alive", () => {
  jest.useFakeTimers()
  try {
    const pass = startListSync("stalls-later", "pull")
    pass.progress()
    pass.progress()
    jest.runOnlyPendingTimers()
    expect(getListSyncStatus("stalls-later")).toBe("error")
  } finally {
    jest.useRealTimers()
  }
})

it("a nested pass on the same list keeps a pass that never touches itself alive (e.g. reconcile wrapping a slow repair)", () => {
  jest.useFakeTimers()
  try {
    const { finish: finishReconcile, progress: reconcileProgress } =
      startListSync("linked-parent", "reconcile")
    const { finish: finishPull, progress } = startListSync(
      "linked-parent",
      "pull",
      reconcileProgress
    )
    // The reconcile pass above never calls progress() itself - only
    // the nested pull's own progress does. Comfortably past a single
    // pass's stale budget, split across several renewals.
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(25_000)
      progress()
    }
    finishPull(true)
    expect(getListSyncStatus("linked-parent")).toBe("syncing")
    finishReconcile(true)
    expect(getListSyncStatus("linked-parent")).toBe("synced")
  } finally {
    jest.useRealTimers()
  }
})

it("ignores a straggler finish() for the exact pass the watchdog already gave up on, rather than resurrecting it", () => {
  jest.useFakeTimers()
  try {
    const { finish } = startListSync("stuck-pull", "pull")
    jest.runOnlyPendingTimers()
    expect(getListSyncStatus("stuck-pull")).toBe("error")
    // The original request finally settles after the watchdog already
    // cleared it - must not flip "error" back to "synced" as if a real
    // pull had just succeeded.
    finish(true)
    expect(getListSyncStatus("stuck-pull")).toBe("error")
  } finally {
    jest.useRealTimers()
  }
})

it("does not overwrite a new denial with a stale storage read", async () => {
  let resolveRead!: (value: Result<boolean, Error>) => void
  jest
    .mocked(ListSyncStateRepository.prototype.isPermissionDenied)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve
      })
    )
  jest
    .mocked(ListSyncStateRepository.prototype.setPermissionDenied)
    .mockResolvedValueOnce(Result.ok(undefined))
  const loading = loadListSyncPermission("race")
  await setListPermissionDenied("race", true)
  resolveRead(Result.ok(false))
  await loading
  expect(getListSyncStatus("race")).toBe("forbidden")
})

it("does not let successful downloads conceal a stalled upload on the same list", () => {
  jest.useFakeTimers()
  try {
    const stalled = startListSync("independent", "push")
    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(9_000)
      const other = startListSync("independent", "pull")
      other.progress()
      other.finish(true)
    }
    expect(getListSyncStatus("independent")).toBe("error")
    stalled.finish(true)
    expect(getListSyncStatus("independent")).toBe("error")
    startListSync("independent", "push").finish(true)
    expect(getListSyncStatus("independent")).toBe("synced")
  } finally {
    jest.useRealTimers()
  }
})
