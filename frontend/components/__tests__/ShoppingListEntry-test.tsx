import {
  startListSync,
  setListPermissionDenied,
} from "@/api/sync/list-sync-status"
import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { Result } from "@/api/common/result"
import * as React from "react"
import * as ReactNative from "react-native"
import { act, render, fireEvent } from "@testing-library/react-native"
import { ShoppingListEntry, ShoppingListEntryProps } from "../ShoppingListEntry"

// The real @expo/vector-icons component loads its font asynchronously, which
// makes its rendered output non-deterministic in tests. Stub it with a plain
// Text so the icon name can be asserted on synchronously.
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native")
  return {
    MaterialIcons: ({ name, testID }: { name: string; testID?: string }) => (
      <Text testID={testID}>{name}</Text>
    ),
  }
})

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return { ...originalModule, DB_NAME: ":memory:" }
})
jest.mock("@/database/list-sync-state-repository")
jest
  .mocked(ListSyncStateRepository.prototype.isPermissionDenied)
  .mockResolvedValue(Result.ok(false))
jest
  .mocked(ListSyncStateRepository.prototype.setPermissionDenied)
  .mockResolvedValue(Result.ok(undefined))

// Define default props
const defaultProps: ShoppingListEntryProps = {
  id: "1",
  listName: "Default Shopping List",
  createdAt: 1678886400000, // March 15, 2023
  totalCount: 5,
  completedCount: 2,
  onPress: jest.fn(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
}

describe("ShoppingListEntry", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("renders correctly", async () => {
    const { toJSON } = await render(<ShoppingListEntry {...defaultProps} />)

    expect(toJSON()).toMatchSnapshot()
  })

  it("renders consistent dark list rows", async () => {
    const theme = jest
      .spyOn(ReactNative, "useColorScheme")
      .mockReturnValue("dark")
    try {
      const { toJSON, rerender } = await render(
        <ShoppingListEntry
          {...defaultProps}
          listName="Weekly groceries"
          totalCount={12}
          completedCount={4}
        />
      )
      expect(toJSON()).toMatchSnapshot()
      await rerender(
        <ShoppingListEntry {...defaultProps} listName="Drugstore" />
      )
      expect(toJSON()).toMatchSnapshot()
    } finally {
      theme.mockRestore()
    }
  })

  it("renders correctly without counts", async () => {
    const { toJSON } = await render(
      <ShoppingListEntry
        {...defaultProps}
        totalCount={undefined}
        completedCount={undefined}
      />
    )

    expect(toJSON()).toMatchSnapshot()
  })

  it("displays list name", async () => {
    const { getByText } = await render(
      <ShoppingListEntry {...defaultProps} listName="Groceries" />
    )

    expect(getByText("Groceries")).toBeTruthy()
  })

  it("displays privacy and article count", async () => {
    const { getByText } = await render(<ShoppingListEntry {...defaultProps} />)

    expect(getByText("Private · 5 items")).toBeTruthy()
  })

  it("displays open count", async () => {
    const { getByText } = await render(<ShoppingListEntry {...defaultProps} />)

    expect(getByText("3 open")).toBeTruthy()
  })

  it("does not display counts when totalCount is undefined", async () => {
    const { queryByText } = await render(
      <ShoppingListEntry
        {...defaultProps}
        totalCount={undefined}
        completedCount={2}
      />
    )

    expect(queryByText(/open/)).toBeFalsy()
  })

  it("does not display progress bar when totalCount is 0", async () => {
    const { queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} totalCount={0} completedCount={0} />
    )

    expect(queryByTestId("progress-bar")).toBeFalsy()
  })

  it("calls onPress when pressed", async () => {
    const onPress = jest.fn()
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onPress={onPress} />
    )

    await fireEvent.press(getByTestId("shopping-list-entry-1"))

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("opens the context menu on long press", async () => {
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-rename-1")).toBeTruthy()
    expect(getByTestId("shopping-list-context-duplicate-1")).toBeTruthy()
    expect(getByTestId("shopping-list-context-sync-1")).toBeTruthy()
    expect(getByTestId("shopping-list-context-delete-1")).toBeTruthy()
  })

  it("shows Duplicate even when sync is off and interactions are disabled", async () => {
    const { getByTestId } = await render(
      <ShoppingListEntry
        {...defaultProps}
        syncEnabled={false}
        syncToggleDisabled
      />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-duplicate-1")).toBeTruthy()
  })

  it("reflects syncEnabled as the sync toggle value", async () => {
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} syncEnabled />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-sync-1").props.value).toBe(true)
  })

  it("disables the sync toggle when syncToggleDisabled is set", async () => {
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} syncToggleDisabled />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-sync-1").props.disabled).toBe(
      true
    )
  })

  it("calls onToggleSync when the sync toggle is changed", async () => {
    const onToggleSync = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onToggleSync={onToggleSync} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent(
      getByTestId("shopping-list-context-sync-1"),
      "valueChange",
      true
    )

    expect(onToggleSync).toHaveBeenCalledWith(true)
    // The context menu stays open so the state change is visible.
    expect(queryByTestId("shopping-list-context-sync-1")).toBeTruthy()
  })

  it("does not show Re-sync from server when sync is off", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} syncEnabled={false} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(queryByTestId("shopping-list-context-resync-1")).toBeFalsy()
  })

  it("shows Re-sync from server when sync is on", async () => {
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} syncEnabled />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-resync-1")).toBeTruthy()
  })

  it("does not show Re-sync from server when sync interactions are disabled (e.g. signed out)", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} syncEnabled syncToggleDisabled />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(queryByTestId("shopping-list-context-resync-1")).toBeFalsy()
  })

  it("shows a cloud icon when synced and cloud-off when local-only", async () => {
    const { getByTestId, rerender } = await render(
      <ShoppingListEntry {...defaultProps} syncEnabled />
    )

    expect(getByTestId("shopping-list-sync-icon-1").props.children).toBe(
      "cloud"
    )

    await rerender(<ShoppingListEntry {...defaultProps} syncEnabled={false} />)

    expect(getByTestId("shopping-list-sync-icon-1").props.children).toBe(
      "cloud-off"
    )
  })

  it("calls onResync when Re-sync from server is pressed", async () => {
    const onResync = jest.fn()
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} syncEnabled onResync={onResync} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-resync-1"))

    expect(onResync).toHaveBeenCalledTimes(1)
  })

  it("opens the rename sheet when Rename is pressed in the context menu", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-rename-1"))

    expect(getByTestId("shopping-list-rename-sheet-1-input")).toBeTruthy()
    expect(queryByTestId("shopping-list-context-rename-1")).toBeFalsy()
  })

  it("pre-fills the rename input with the current name", async () => {
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-rename-1"))

    expect(getByTestId("shopping-list-rename-sheet-1-input").props.value).toBe(
      "Default Shopping List"
    )
  })

  it("calls onRename with the new name when Save is pressed", async () => {
    const onRename = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onRename={onRename} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-rename-1"))
    await fireEvent.changeText(
      getByTestId("shopping-list-rename-sheet-1-input"),
      "New List Name"
    )
    await fireEvent.press(getByTestId("shopping-list-rename-sheet-1-save"))

    expect(onRename).toHaveBeenCalledWith("New List Name")
    expect(queryByTestId("shopping-list-rename-sheet-1-input")).toBeFalsy()
  })

  it("does not call onRename when the rename input is submitted empty", async () => {
    const onRename = jest.fn()
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onRename={onRename} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-rename-1"))
    await fireEvent.changeText(
      getByTestId("shopping-list-rename-sheet-1-input"),
      "   "
    )
    await fireEvent.press(getByTestId("shopping-list-rename-sheet-1-save"))

    expect(onRename).not.toHaveBeenCalled()
  })

  it("discards the rename when Cancel is pressed", async () => {
    const onRename = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onRename={onRename} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-rename-1"))
    await fireEvent.changeText(
      getByTestId("shopping-list-rename-sheet-1-input"),
      "Something else"
    )
    await fireEvent.press(getByTestId("shopping-list-rename-sheet-1-cancel"))

    expect(onRename).not.toHaveBeenCalled()
    expect(queryByTestId("shopping-list-rename-sheet-1-input")).toBeFalsy()
  })

  it("opens the duplicate sheet pre-filled with '<name> (Copy)' when Duplicate is pressed", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-duplicate-1"))

    expect(
      getByTestId("shopping-list-duplicate-sheet-1-input").props.value
    ).toBe("Default Shopping List (Copy)")
    expect(queryByTestId("shopping-list-context-duplicate-1")).toBeFalsy()
  })

  it("calls onDuplicate with the (possibly edited) name when Save is pressed", async () => {
    const onDuplicate = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onDuplicate={onDuplicate} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-duplicate-1"))
    await fireEvent.changeText(
      getByTestId("shopping-list-duplicate-sheet-1-input"),
      "Weekend trip"
    )
    await fireEvent.press(getByTestId("shopping-list-duplicate-sheet-1-save"))

    expect(onDuplicate).toHaveBeenCalledWith("Weekend trip")
    expect(queryByTestId("shopping-list-duplicate-sheet-1-input")).toBeFalsy()
  })

  it("does not call onDuplicate when the duplicate sheet is cancelled", async () => {
    const onDuplicate = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onDuplicate={onDuplicate} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-duplicate-1"))
    await fireEvent.press(getByTestId("shopping-list-duplicate-sheet-1-cancel"))

    expect(onDuplicate).not.toHaveBeenCalled()
    expect(queryByTestId("shopping-list-duplicate-sheet-1-input")).toBeFalsy()
  })

  it("opens the delete confirmation when Delete is pressed in the context menu", async () => {
    const { getByTestId, getByText } = await render(
      <ShoppingListEntry {...defaultProps} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-delete-1"))

    expect(getByTestId("shopping-list-delete-confirm-1-confirm")).toBeTruthy()
    expect(
      getByText(
        '"Default Shopping List" and its 5 ingredients will be permanently removed.'
      )
    ).toBeTruthy()
  })

  it("uses singular 'ingredient' in the delete message when count is 1", async () => {
    const { getByTestId, getByText } = await render(
      <ShoppingListEntry {...defaultProps} totalCount={1} completedCount={0} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-delete-1"))

    expect(
      getByText(
        '"Default Shopping List" and its 1 ingredient will be permanently removed.'
      )
    ).toBeTruthy()
  })

  it("calls onDelete when delete is confirmed", async () => {
    const onDelete = jest.fn()
    const { getByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onDelete={onDelete} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-delete-1"))
    await fireEvent.press(getByTestId("shopping-list-delete-confirm-1-confirm"))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it("does not call onDelete when delete is cancelled", async () => {
    const onDelete = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <ShoppingListEntry {...defaultProps} onDelete={onDelete} />
    )

    await fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    await fireEvent.press(getByTestId("shopping-list-context-delete-1"))
    await fireEvent.press(getByTestId("shopping-list-delete-confirm-1-cancel"))

    expect(onDelete).not.toHaveBeenCalled()
    expect(queryByTestId("shopping-list-delete-confirm-1-confirm")).toBeFalsy()
  })
})

it("updates only the failed list and keeps a permanent rejection visible when disabled", async () => {
  const { getByTestId, getByText, rerender } = await render(
    <>
      <ShoppingListEntry {...defaultProps} id="status-bad" syncEnabled />
      <ShoppingListEntry {...defaultProps} id="status-good" syncEnabled />
    </>
  )
  await act(() => {
    startListSync("status-bad", "push").finish(false)
    startListSync("status-good", "push").finish(true)
  })
  expect(getByTestId("shopping-list-sync-icon-status-bad")).toHaveTextContent(
    /error/
  )
  expect(getByTestId("shopping-list-sync-icon-status-good")).toHaveTextContent(
    /cloud-done/
  )
  await rerender(
    <ShoppingListEntry {...defaultProps} id="status-bad" syncEnabled={false} />
  )
  expect(getByText(/Sync disabled after failure/)).toBeTruthy()
})

it("explains denied sync even when sync is disabled without opening the list", async () => {
  await setListPermissionDenied("denied-entry", true)
  const onPress = jest.fn()
  const screen = await render(
    <ShoppingListEntry
      {...defaultProps}
      id="denied-entry"
      syncEnabled={false}
      onPress={onPress}
    />
  )
  expect(
    screen.getByTestId("shopping-list-sync-icon-denied-entry")
  ).toHaveTextContent("lock")
  const stopPropagation = jest.fn()
  await fireEvent.press(
    screen.getByRole("button", { name: "No permission to sync" }),
    { stopPropagation }
  )
  expect(stopPropagation).toHaveBeenCalled()
  expect(onPress).not.toHaveBeenCalled()
  expect(screen.getByText(/The owner may have removed you/)).toBeTruthy()
  await fireEvent.press(screen.getByText("Close"))
  expect(screen.queryByText(/The owner may have removed you/)).toBeNull()
})
