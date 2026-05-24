import * as React from "react"
import { render, fireEvent } from "@testing-library/react-native"
import { Entry, EntryProps } from "../Entry"
import { Alert } from "react-native"

// Mock Alert
jest.spyOn(Alert, "alert")

// Define default props
const defaultProps: EntryProps = {
  id: "1",
  ingredientName: "Default Ingredient",
  isCompleted: false,
  onToggleComplete: jest.fn(),
  onLongPress: jest.fn(),
  isEdited: false,
  onCancelEditing: jest.fn(),
  onSaveEditing: jest.fn(),
  onDelete: jest.fn(),
}

describe("Entry", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it(`renders correctly`, () => {
    const { toJSON } = render(<Entry {...defaultProps} ingredientName={""} />)

    expect(toJSON()).toMatchSnapshot()
  })

  it("renders correctly in edit mode", () => {
    const { toJSON } = render(<Entry {...defaultProps} isEdited={true} />)

    expect(toJSON()).toMatchSnapshot()
  })

  it("applies correct style when isCompleted is true", () => {
    const { getByText } = render(
      <Entry {...defaultProps} ingredientName={"Tomato"} isCompleted={true} />
    )

    const entryText = getByText("Tomato")

    expect(entryText).toHaveStyle({
      textDecorationLine: "line-through",
    })
  })

  it("applies correct style when isCompleted is false", () => {
    const { getByText } = render(
      <Entry {...defaultProps} ingredientName={"Tomato"} isCompleted={false} />
    )

    const entryText = getByText("Tomato")

    expect(entryText).toHaveStyle({
      textDecorationLine: "none",
    })
  })

  it("shows input field when in edit mode", () => {
    const { getByTestId } = render(<Entry {...defaultProps} isEdited={true} />)

    expect(getByTestId("entry-input-1")).toBeTruthy()
  })

  it("shows save, cancel, and delete buttons when in edit mode", () => {
    const { getByTestId } = render(<Entry {...defaultProps} isEdited={true} />)

    expect(getByTestId("save-button-1")).toBeTruthy()
    expect(getByTestId("cancel-button-1")).toBeTruthy()
    expect(getByTestId("delete-button-1")).toBeTruthy()
  })

  it("calls onSaveEditing when save button is pressed", () => {
    const onSaveEditing = jest.fn()
    const { getByTestId } = render(
      <Entry {...defaultProps} isEdited={true} onSaveEditing={onSaveEditing} />
    )

    fireEvent.press(getByTestId("save-button-1"))

    expect(onSaveEditing).toHaveBeenCalledTimes(1)
    expect(onSaveEditing).toHaveBeenCalledWith("Default Ingredient")
  })

  it("calls onCancelEditing when cancel button is pressed", () => {
    const onCancelEditing = jest.fn()
    const { getByTestId } = render(
      <Entry
        {...defaultProps}
        isEdited={true}
        onCancelEditing={onCancelEditing}
      />
    )

    fireEvent.press(getByTestId("cancel-button-1"))

    expect(onCancelEditing).toHaveBeenCalledTimes(1)
  })

  it("updates input value when text changes", () => {
    const { getByTestId } = render(<Entry {...defaultProps} isEdited={true} />)

    const input = getByTestId("entry-input-1")
    fireEvent.changeText(input, "New Ingredient Name")

    expect(input.props.value).toBe("New Ingredient Name")
  })

  it("shows delete confirmation alert when delete button is pressed", () => {
    const { getByTestId } = render(<Entry {...defaultProps} isEdited={true} />)

    fireEvent.press(getByTestId("delete-button-1"))

    expect(Alert.alert).toHaveBeenCalledWith(
      "Delete Ingredient",
      'Do you really want to delete "Default Ingredient"?',
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel", style: "cancel" }),
        expect.objectContaining({ text: "Delete", style: "destructive" }),
      ])
    )
  })

  it("calls onDelete when delete is confirmed in alert", () => {
    const onDelete = jest.fn()
    const { getByTestId } = render(
      <Entry {...defaultProps} isEdited={true} onDelete={onDelete} />
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
      <Entry {...defaultProps} isEdited={true} onDelete={onDelete} />
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
      <Entry {...defaultProps} isEdited={true} onSaveEditing={onSaveEditing} />
    )

    const input = getByTestId("entry-input-1")
    fireEvent.changeText(input, "Updated Ingredient Name")
    fireEvent(input, "submitEditing")

    expect(onSaveEditing).toHaveBeenCalledWith("Updated Ingredient Name")
  })
})
