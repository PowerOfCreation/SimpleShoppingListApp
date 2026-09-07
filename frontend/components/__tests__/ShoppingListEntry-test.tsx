import { startListSync } from "@/api/sync/list-sync-status"
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

  it("renders correctly", () => {
    const { toJSON } = render(<ShoppingListEntry {...defaultProps} />)

    expect(toJSON()).toMatchSnapshot()
  })

  it("renders consistent dark list rows", () => {
    const theme = jest
      .spyOn(ReactNative, "useColorScheme")
      .mockReturnValue("dark")
    try {
      const { toJSON, rerender } = render(
        <ShoppingListEntry
          {...defaultProps}
          listName="Weekly groceries"
          totalCount={12}
          completedCount={4}
        />
      )
      expect(toJSON()).toMatchSnapshot()
      rerender(<ShoppingListEntry {...defaultProps} listName="Drugstore" />)
      expect(toJSON()).toMatchSnapshot()
    } finally {
      theme.mockRestore()
    }
  })

  it("renders correctly without counts", () => {
    const { toJSON } = render(
      <ShoppingListEntry
        {...defaultProps}
        totalCount={undefined}
        completedCount={undefined}
      />
    )

    expect(toJSON()).toMatchSnapshot()
  })

  it("displays list name", () => {
    const { getByText } = render(
      <ShoppingListEntry {...defaultProps} listName="Groceries" />
    )

    expect(getByText("Groceries")).toBeTruthy()
  })

  it("displays privacy and article count", () => {
    const { getByText } = render(<ShoppingListEntry {...defaultProps} />)

    expect(getByText("Private · 5 items")).toBeTruthy()
  })

  it("displays open count", () => {
    const { getByText } = render(<ShoppingListEntry {...defaultProps} />)

    expect(getByText("3 open")).toBeTruthy()
  })

  it("does not display counts when totalCount is undefined", () => {
    const { queryByText } = render(
      <ShoppingListEntry
        {...defaultProps}
        totalCount={undefined}
        completedCount={2}
      />
    )

    expect(queryByText(/open/)).toBeFalsy()
  })

  it("does not display progress bar when totalCount is 0", () => {
    const { queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} totalCount={0} completedCount={0} />
    )

    expect(queryByTestId("progress-bar")).toBeFalsy()
  })

  it("calls onPress when pressed", () => {
    const onPress = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} onPress={onPress} />
    )

    fireEvent.press(getByTestId("shopping-list-entry-1"))

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("opens the context menu on long press", () => {
    const { getByTestId } = render(<ShoppingListEntry {...defaultProps} />)

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-rename-1")).toBeTruthy()
    expect(getByTestId("shopping-list-context-sync-1")).toBeTruthy()
    expect(getByTestId("shopping-list-context-delete-1")).toBeTruthy()
  })

  it("reflects syncEnabled as the sync toggle value", () => {
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} syncEnabled />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-sync-1").props.value).toBe(true)
  })

  it("disables the sync toggle when syncToggleDisabled is set", () => {
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} syncToggleDisabled />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-sync-1").props.disabled).toBe(
      true
    )
  })

  it("calls onToggleSync when the sync toggle is changed", () => {
    const onToggleSync = jest.fn()
    const { getByTestId, queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} onToggleSync={onToggleSync} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent(getByTestId("shopping-list-context-sync-1"), "valueChange", true)

    expect(onToggleSync).toHaveBeenCalledWith(true)
    // The context menu stays open so the state change is visible.
    expect(queryByTestId("shopping-list-context-sync-1")).toBeTruthy()
  })

  it("does not show Re-sync from server when sync is off", () => {
    const { getByTestId, queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} syncEnabled={false} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(queryByTestId("shopping-list-context-resync-1")).toBeFalsy()
  })

  it("shows Re-sync from server when sync is on", () => {
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} syncEnabled />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(getByTestId("shopping-list-context-resync-1")).toBeTruthy()
  })

  it("does not show Re-sync from server when sync interactions are disabled (e.g. signed out)", () => {
    const { getByTestId, queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} syncEnabled syncToggleDisabled />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(queryByTestId("shopping-list-context-resync-1")).toBeFalsy()
  })

  it("shows a cloud icon when synced and cloud-off when local-only", () => {
    const { getByTestId, rerender } = render(
      <ShoppingListEntry {...defaultProps} syncEnabled />
    )

    expect(getByTestId("shopping-list-sync-icon-1").props.children).toBe(
      "cloud"
    )

    rerender(<ShoppingListEntry {...defaultProps} syncEnabled={false} />)

    expect(getByTestId("shopping-list-sync-icon-1").props.children).toBe(
      "cloud-off"
    )
  })

  it("calls onResync when Re-sync from server is pressed", () => {
    const onResync = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} syncEnabled onResync={onResync} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-resync-1"))

    expect(onResync).toHaveBeenCalledTimes(1)
  })

  it("opens the rename sheet when Rename is pressed in the context menu", () => {
    const { getByTestId, queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-rename-1"))

    expect(getByTestId("shopping-list-rename-sheet-1-input")).toBeTruthy()
    expect(queryByTestId("shopping-list-context-rename-1")).toBeFalsy()
  })

  it("pre-fills the rename input with the current name", () => {
    const { getByTestId } = render(<ShoppingListEntry {...defaultProps} />)

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-rename-1"))

    expect(getByTestId("shopping-list-rename-sheet-1-input").props.value).toBe(
      "Default Shopping List"
    )
  })

  it("calls onRename with the new name when Save is pressed", () => {
    const onRename = jest.fn()
    const { getByTestId, queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} onRename={onRename} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-rename-1"))
    fireEvent.changeText(
      getByTestId("shopping-list-rename-sheet-1-input"),
      "New List Name"
    )
    fireEvent.press(getByTestId("shopping-list-rename-sheet-1-save"))

    expect(onRename).toHaveBeenCalledWith("New List Name")
    expect(queryByTestId("shopping-list-rename-sheet-1-input")).toBeFalsy()
  })

  it("does not call onRename when the rename input is submitted empty", () => {
    const onRename = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} onRename={onRename} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-rename-1"))
    fireEvent.changeText(
      getByTestId("shopping-list-rename-sheet-1-input"),
      "   "
    )
    fireEvent.press(getByTestId("shopping-list-rename-sheet-1-save"))

    expect(onRename).not.toHaveBeenCalled()
  })

  it("discards the rename when Cancel is pressed", () => {
    const onRename = jest.fn()
    const { getByTestId, queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} onRename={onRename} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-rename-1"))
    fireEvent.changeText(
      getByTestId("shopping-list-rename-sheet-1-input"),
      "Something else"
    )
    fireEvent.press(getByTestId("shopping-list-rename-sheet-1-cancel"))

    expect(onRename).not.toHaveBeenCalled()
    expect(queryByTestId("shopping-list-rename-sheet-1-input")).toBeFalsy()
  })

  it("opens the delete confirmation when Delete is pressed in the context menu", () => {
    const { getByTestId, getByText } = render(
      <ShoppingListEntry {...defaultProps} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-delete-1"))

    expect(getByTestId("shopping-list-delete-confirm-1-confirm")).toBeTruthy()
    expect(
      getByText(
        '"Default Shopping List" and its 5 ingredients will be permanently removed.'
      )
    ).toBeTruthy()
  })

  it("uses singular 'ingredient' in the delete message when count is 1", () => {
    const { getByTestId, getByText } = render(
      <ShoppingListEntry {...defaultProps} totalCount={1} completedCount={0} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-delete-1"))

    expect(
      getByText(
        '"Default Shopping List" and its 1 ingredient will be permanently removed.'
      )
    ).toBeTruthy()
  })

  it("calls onDelete when delete is confirmed", () => {
    const onDelete = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} onDelete={onDelete} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-delete-1"))
    fireEvent.press(getByTestId("shopping-list-delete-confirm-1-confirm"))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it("does not call onDelete when delete is cancelled", () => {
    const onDelete = jest.fn()
    const { getByTestId, queryByTestId } = render(
      <ShoppingListEntry {...defaultProps} onDelete={onDelete} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")
    fireEvent.press(getByTestId("shopping-list-context-delete-1"))
    fireEvent.press(getByTestId("shopping-list-delete-confirm-1-cancel"))

    expect(onDelete).not.toHaveBeenCalled()
    expect(queryByTestId("shopping-list-delete-confirm-1-confirm")).toBeFalsy()
  })
})

it("updates only the failed list and keeps a permanent rejection visible when disabled", () => {
  const { getByTestId, getByText, rerender } = render(
    <>
      <ShoppingListEntry {...defaultProps} id="status-bad" syncEnabled />
      <ShoppingListEntry {...defaultProps} id="status-good" syncEnabled />
    </>
  )
  act(() => {
    startListSync("status-bad", "push")(false)
    startListSync("status-good", "push")(true)
  })
  expect(getByTestId("shopping-list-sync-icon-status-bad")).toHaveTextContent(
    /error/
  )
  expect(getByTestId("shopping-list-sync-icon-status-good")).toHaveTextContent(
    /cloud-done/
  )
  rerender(
    <ShoppingListEntry {...defaultProps} id="status-bad" syncEnabled={false} />
  )
  expect(getByText(/Sync failed · Sync disabled/)).toBeTruthy()
})
