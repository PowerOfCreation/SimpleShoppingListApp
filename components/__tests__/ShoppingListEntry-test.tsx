import * as React from "react"
import { render, fireEvent } from "@testing-library/react-native"
import { ShoppingListEntry, ShoppingListEntryProps } from "../ShoppingListEntry"
import { Alert } from "react-native"

// Mock Alert
jest.spyOn(Alert, "alert")

// Define default props
const defaultProps: ShoppingListEntryProps = {
  id: "1",
  listName: "Default Shopping List",
  createdAt: 1678886400000, // March 15, 2023
  totalCount: 5,
  completedCount: 2,
  onPress: jest.fn(),
  onLongPress: jest.fn(),
  isEdited: false,
  onCancelEditing: jest.fn(),
  onSaveEditing: jest.fn(),
  onDelete: jest.fn(),
}

describe("ShoppingListEntry", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("renders correctly in non-edit mode", () => {
    const { toJSON } = render(<ShoppingListEntry {...defaultProps} />)

    expect(toJSON()).toMatchSnapshot()
  })

  it("renders correctly in edit mode", () => {
    const { toJSON } = render(
      <ShoppingListEntry {...defaultProps} isEdited={true} />
    )

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

  it("calls onLongPress when long pressed", () => {
    const onLongPress = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} onLongPress={onLongPress} />
    )

    fireEvent(getByTestId("shopping-list-entry-1"), "longPress")

    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it("shows input field when in edit mode", () => {
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} isEdited={true} />
    )

    expect(getByTestId("shopping-list-input-1")).toBeTruthy()
  })

  it("shows save, cancel, and delete buttons when in edit mode", () => {
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} isEdited={true} />
    )

    expect(getByTestId("save-button-1")).toBeTruthy()
    expect(getByTestId("cancel-button-1")).toBeTruthy()
    expect(getByTestId("delete-button-1")).toBeTruthy()
  })

  it("calls onSaveEditing when save button is pressed", () => {
    const onSaveEditing = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry
        {...defaultProps}
        isEdited={true}
        onSaveEditing={onSaveEditing}
      />
    )

    fireEvent.press(getByTestId("save-button-1"))

    expect(onSaveEditing).toHaveBeenCalledTimes(1)
    expect(onSaveEditing).toHaveBeenCalledWith("Default Shopping List")
  })

  it("calls onCancelEditing when cancel button is pressed", () => {
    const onCancelEditing = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry
        {...defaultProps}
        isEdited={true}
        onCancelEditing={onCancelEditing}
      />
    )

    fireEvent.press(getByTestId("cancel-button-1"))

    expect(onCancelEditing).toHaveBeenCalledTimes(1)
  })

  it("updates input value when text changes", () => {
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} isEdited={true} />
    )

    const input = getByTestId("shopping-list-input-1")
    fireEvent.changeText(input, "New List Name")

    expect(input.props.value).toBe("New List Name")
  })

  it("shows delete confirmation alert when delete button is pressed", () => {
    const { getByTestId } = render(
      <ShoppingListEntry {...defaultProps} isEdited={true} />
    )

    fireEvent.press(getByTestId("delete-button-1"))

    expect(Alert.alert).toHaveBeenCalledWith(
      "Delete Shopping List",
      'Do you really want to delete list "Default Shopping List" with 5 ingredients?',
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel", style: "cancel" }),
        expect.objectContaining({ text: "Delete", style: "destructive" }),
      ])
    )
  })

  it("uses singular 'ingredient' in delete alert when count is 1", () => {
    const { getByTestId } = render(
      <ShoppingListEntry
        {...defaultProps}
        isEdited={true}
        totalCount={1}
        completedCount={0}
      />
    )

    fireEvent.press(getByTestId("delete-button-1"))

    expect(Alert.alert).toHaveBeenCalledWith(
      "Delete Shopping List",
      'Do you really want to delete list "Default Shopping List" with 1 ingredient?',
      expect.any(Array)
    )
  })

  it("calls onDelete when delete is confirmed in alert", () => {
    const onDelete = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry
        {...defaultProps}
        isEdited={true}
        onDelete={onDelete}
      />
    )

    fireEvent.press(getByTestId("delete-button-1"))

    // Get the alert buttons and simulate pressing "Delete"
    const alertCalls = (Alert.alert as jest.Mock).mock.calls
    const lastCall = alertCalls[alertCalls.length - 1]
    const buttons = lastCall[2]
    const deleteButton = buttons.find(
      (btn: { text: string; onPress?: () => void }) => btn.text === "Delete"
    )

    deleteButton.onPress()

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it("does not call onDelete when delete is cancelled in alert", () => {
    const onDelete = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry
        {...defaultProps}
        isEdited={true}
        onDelete={onDelete}
      />
    )

    fireEvent.press(getByTestId("delete-button-1"))

    // Get the alert buttons and simulate pressing "Cancel" (which doesn't have an onPress)
    const alertCalls = (Alert.alert as jest.Mock).mock.calls
    const lastCall = alertCalls[alertCalls.length - 1]
    const buttons = lastCall[2]
    const cancelButton = buttons.find(
      (btn: { text: string; onPress?: () => void }) => btn.text === "Cancel"
    )

    // Cancel button doesn't have an onPress handler (it just dismisses)
    expect(cancelButton.onPress).toBeUndefined()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("calls onSaveEditing when input is submitted", () => {
    const onSaveEditing = jest.fn()
    const { getByTestId } = render(
      <ShoppingListEntry
        {...defaultProps}
        isEdited={true}
        onSaveEditing={onSaveEditing}
      />
    )

    const input = getByTestId("shopping-list-input-1")
    fireEvent.changeText(input, "Updated List Name")
    fireEvent(input, "submitEditing")

    expect(onSaveEditing).toHaveBeenCalledWith("Updated List Name")
  })
})
