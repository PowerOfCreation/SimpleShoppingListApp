import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { Result } from "@/api/common/result"
import {
  getListSyncStatus,
  startListSync,
  loadListSyncPermission,
  setListPermissionDenied,
} from "../list-sync-status"
jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return { ...originalModule, DB_NAME: ":memory:" }
})
jest.mock("@/database/list-sync-state-repository")

it("isolates lists and keeps upload errors until an upload succeeds", () => {
  startListSync("a", "push")(false)
  startListSync("b", "push")(true)
  startListSync("a", "pull")(true)
  expect(getListSyncStatus("a")).toBe("error")
  expect(getListSyncStatus("b")).toBe("synced")
  const finish = startListSync("a", "push")
  expect(getListSyncStatus("a")).toBe("syncing")
  finish(true)
  expect(getListSyncStatus("a")).toBe("synced")
})

it("retains failures across batches and overlapping operations", () => {
  const finish = startListSync("batches", "push")
  startListSync("batches", "push")(false)
  startListSync("batches", "push")(true)
  finish(true)
  expect(getListSyncStatus("batches")).toBe("error")
})

it("does not clear a download failure with an upload", () => {
  startListSync("download", "pull")(false)
  startListSync("download", "push")(true)
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
  startListSync("persisted", "push")(false)
  expect(getListSyncStatus("persisted")).toBe("forbidden")
  await setListPermissionDenied("persisted", false)
  expect(setPermissionDenied).toHaveBeenLastCalledWith("persisted", false)
  expect(getListSyncStatus("persisted")).toBe("error")
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
