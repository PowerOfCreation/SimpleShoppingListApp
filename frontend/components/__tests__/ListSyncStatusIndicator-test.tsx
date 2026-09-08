import { render, fireEvent } from "@testing-library/react-native"
import { ListSyncStatusIndicator } from "../ListSyncStatusIndicator"
import { startListSync } from "@/api/sync/list-sync-status"
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

it.each([
  ["private", false, undefined, "Private", /stored on this device/],
  ["enabled", true, undefined, "Sync enabled", /not yet been confirmed/],
  ["syncing", true, "syncing", "Syncing…", /currently synchronizing/],
  ["synced", true, "synced", "Synced", /completed successfully/],
  ["error", true, "error", "Sync failed", /could not be synchronized/],
] as const)(
  "opens and closes the explanation for %s",
  (id, enabled, status, label, message) => {
    if (status) {
      const finish = startListSync(id, "push")
      if (status !== "syncing") finish(status === "synced")
    }
    const screen = render(
      <ListSyncStatusIndicator listId={id} syncEnabled={enabled} />
    )
    fireEvent.press(screen.getByRole("button", { name: label }))
    expect(screen.getByText(message)).toBeTruthy()
    fireEvent.press(screen.getByText("Close"))
    expect(screen.queryByText(message)).toBeNull()
  }
)
