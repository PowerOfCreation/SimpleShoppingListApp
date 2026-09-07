import { getPreference, setPreference } from "@/database/preferences-repository"
import {
  getListSyncStatus,
  startListSync,
  loadListSyncPermission,
  setListPermissionDenied,
} from "../list-sync-status"
jest.mock("@/database/preferences-repository")

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
  jest.mocked(getPreference).mockResolvedValueOnce("true")
  await loadListSyncPermission("persisted")
  expect(getListSyncStatus("persisted")).toBe("forbidden")
  startListSync("persisted", "push")(false)
  expect(getListSyncStatus("persisted")).toBe("forbidden")
  await setListPermissionDenied("persisted", false)
  expect(setPreference).toHaveBeenLastCalledWith(
    "sync_permission_denied:persisted",
    "false"
  )
  expect(getListSyncStatus("persisted")).toBe("error")
})

it("does not overwrite a new denial with a stale storage read", async () => {
  let resolveRead!: (value: string | null) => void
  jest.mocked(getPreference).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveRead = resolve
    })
  )
  const loading = loadListSyncPermission("race")
  await setListPermissionDenied("race", true)
  resolveRead(null)
  await loading
  expect(getListSyncStatus("race")).toBe("forbidden")
})
