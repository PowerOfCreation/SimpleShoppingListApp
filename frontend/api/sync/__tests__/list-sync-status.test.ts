import { getListSyncStatus, startListSync } from "../list-sync-status"

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
