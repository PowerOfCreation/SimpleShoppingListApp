import * as React from "react"
import { render, fireEvent } from "@testing-library/react-native"
import { ShoppingListEntry, ShoppingListEntryProps } from "../ShoppingListEntry"

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

  it("displays formatted date", () => {
    const { getByText } = render(<ShoppingListEntry {...defaultProps} />)

    const expectedDate = new Date(1678886400000).toLocaleDateString()
    expect(getByText(expectedDate)).toBeTruthy()
  })

  it("displays completed count and total count", () => {
    const { getByText } = render(<ShoppingListEntry {...defaultProps} />)

    expect(getByText("2/5")).toBeTruthy()
  })

  it("does not display counts when totalCount is undefined", () => {
    const { queryByText } = render(
      <ShoppingListEntry
        {...defaultProps}
        totalCount={undefined}
        completedCount={2}
      />
    )

    expect(queryByText("2/")).toBeFalsy()
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
