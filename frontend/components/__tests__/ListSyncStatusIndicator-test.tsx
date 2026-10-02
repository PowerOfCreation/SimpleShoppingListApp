import { render, fireEvent, act } from "@testing-library/react-native"
import { ListSyncStatusIndicator } from "../ListSyncStatusIndicator"
import { startListSync, clearListSyncStatus } from "@/api/sync/list-sync-status"
import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { Result } from "@/api/common/result"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return { ...originalModule, DB_NAME: ":memory:" }
})
jest.mock("@/database/list-sync-state-repository")
jest
  .mocked(ListSyncStateRepository.prototype.isPermissionDenied)
  .mockResolvedValue(Result.ok(false))
jest
  .mocked(ListSyncStateRepository.prototype.getRejectionReason)
  .mockResolvedValue(Result.ok(null))
jest
  .mocked(ListSyncStateRepository.prototype.setRejectionReason)
  .mockResolvedValue(Result.ok(undefined))

afterEach(async () => {
  await act(() => clearListSyncStatus("syncing"))
})

it.each([
  ["private", false, undefined, "Private", /stored on this device/],
  ["enabled", true, undefined, "Sync enabled", /not yet been confirmed/],
  ["syncing", true, "syncing", "Syncing…", /currently synchronizing/],
  ["synced", true, "synced", "Synced", /completed successfully/],
  ["error", true, "error", "Sync failed", /could not be synchronized/],
] as const)(
  "opens and closes the explanation for %s",
  async (id, enabled, status, label, message) => {
    if (status) {
      const { finish } = startListSync(id, "push")
      if (status !== "syncing") finish(status === "synced")
    }
    const screen = await render(
      <ListSyncStatusIndicator listId={id} syncEnabled={enabled} />
    )
    await fireEvent.press(screen.getByRole("button", { name: label }))
    expect(screen.getByText(message)).toBeTruthy()
    await fireEvent.press(screen.getByText("Close"))
    expect(screen.queryByText(message)).toBeNull()
  }
)

it("tells the user to report a server rejection and shows the reason", async () => {
  jest
    .mocked(ListSyncStateRepository.prototype.getRejectionReason)
    .mockResolvedValueOnce(Result.ok("400: aggregate_id is required"))
  const screen = await render(
    <ListSyncStatusIndicator listId="rejected" syncEnabled={false} />
  )
  await fireEvent.press(
    await screen.findByRole("button", { name: "Sync stopped after a problem" })
  )
  expect(screen.getByText(/contact the developers/)).toBeTruthy()
  expect(screen.getByText(/400: aggregate_id is required/)).toBeTruthy()
})
