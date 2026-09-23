import * as React from "react"
import { render, fireEvent } from "@testing-library/react-native"
import { Entry, EntryProps } from "../Entry"
import { Priority } from "@/types/Priority"

// Define default props
const defaultProps: EntryProps = {
  id: "1",
  ingredientName: "Default Ingredient",
  isCompleted: false,
  onToggleComplete: jest.fn(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
}

describe("Entry", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it(`renders correctly`, async () => {
    const { toJSON } = await render(
      <Entry {...defaultProps} ingredientName={""} />
    )

    expect(toJSON()).toMatchSnapshot()
  })

  it("applies correct style when isCompleted is true", async () => {
    const { getByText } = await render(
      <Entry {...defaultProps} ingredientName={"Tomato"} isCompleted={true} />
    )

    const entryText = getByText("Tomato")

    expect(entryText).toHaveStyle({
      textDecorationLine: "line-through",
    })
  })

  it("applies correct style when isCompleted is false", async () => {
    const { getByText } = await render(
      <Entry {...defaultProps} ingredientName={"Tomato"} isCompleted={false} />
    )

    const entryText = getByText("Tomato")

    expect(entryText).toHaveStyle({
      textDecorationLine: "none",
    })
  })

  it("does not show the context menu by default", async () => {
    const { queryByTestId } = await render(<Entry {...defaultProps} />)

    expect(queryByTestId("entry-context-rename-1")).toBeFalsy()
    expect(queryByTestId("entry-context-delete-1")).toBeFalsy()
  })

  it("opens the context menu on long press", async () => {
    const { getByTestId } = await render(<Entry {...defaultProps} />)

    await fireEvent(getByTestId("entry-component-1"), "longPress")

    expect(getByTestId("entry-context-rename-1")).toBeTruthy()
    expect(getByTestId("entry-context-delete-1")).toBeTruthy()
  })

  it("opens the rename sheet when Rename is pressed in the context menu", async () => {
    const { getByTestId, queryByTestId } = await render(
      <Entry {...defaultProps} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-rename-1"))

    expect(getByTestId("entry-rename-sheet-1-input")).toBeTruthy()
    expect(queryByTestId("entry-context-rename-1")).toBeFalsy()
  })

  it("pre-fills the rename input with the current name", async () => {
    const { getByTestId } = await render(<Entry {...defaultProps} />)

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-rename-1"))

    expect(getByTestId("entry-rename-sheet-1-input").props.value).toBe(
      "Default Ingredient"
    )
  })

  it("calls onRename with the new name when Save is pressed", async () => {
    const onRename = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <Entry {...defaultProps} onRename={onRename} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-rename-1"))
    await fireEvent.changeText(
      getByTestId("entry-rename-sheet-1-input"),
      "New Ingredient Name"
    )
    await fireEvent.press(getByTestId("entry-rename-sheet-1-save"))

    expect(onRename).toHaveBeenCalledWith("New Ingredient Name")
    expect(queryByTestId("entry-rename-sheet-1-input")).toBeFalsy()
  })

  it("does not call onRename when the rename input is submitted empty", async () => {
    const onRename = jest.fn()
    const { getByTestId } = await render(
      <Entry {...defaultProps} onRename={onRename} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-rename-1"))
    await fireEvent.changeText(getByTestId("entry-rename-sheet-1-input"), "   ")
    await fireEvent.press(getByTestId("entry-rename-sheet-1-save"))

    expect(onRename).not.toHaveBeenCalled()
  })

  it("discards the rename when Cancel is pressed", async () => {
    const onRename = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <Entry {...defaultProps} onRename={onRename} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-rename-1"))
    await fireEvent.changeText(
      getByTestId("entry-rename-sheet-1-input"),
      "Something else"
    )
    await fireEvent.press(getByTestId("entry-rename-sheet-1-cancel"))

    expect(onRename).not.toHaveBeenCalled()
    expect(queryByTestId("entry-rename-sheet-1-input")).toBeFalsy()
  })

  it("opens the delete confirmation when Delete is pressed in the context menu", async () => {
    const { getByTestId } = await render(<Entry {...defaultProps} />)

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-delete-1"))

    expect(getByTestId("entry-delete-confirm-1-confirm")).toBeTruthy()
  })

  it("calls onDelete when delete is confirmed", async () => {
    const onDelete = jest.fn()
    const { getByTestId } = await render(
      <Entry {...defaultProps} onDelete={onDelete} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-delete-1"))
    await fireEvent.press(getByTestId("entry-delete-confirm-1-confirm"))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it("does not call onDelete when delete is cancelled", async () => {
    const onDelete = jest.fn()
    const { getByTestId, queryByTestId } = await render(
      <Entry {...defaultProps} onDelete={onDelete} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-delete-1"))
    await fireEvent.press(getByTestId("entry-delete-confirm-1-cancel"))

    expect(onDelete).not.toHaveBeenCalled()
    expect(queryByTestId("entry-delete-confirm-1-confirm")).toBeFalsy()
  })

  it("opens the priority picker when Change priority is pressed in the context menu", async () => {
    const { getByTestId, queryByTestId } = await render(
      <Entry {...defaultProps} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-priority-1"))

    expect(getByTestId("entry-priority-picker-1-option-0")).toBeTruthy()
    expect(queryByTestId("entry-context-rename-1")).toBeFalsy()
  })

  it("calls onSetPriority when a priority is picked and applied", async () => {
    const onSetPriority = jest.fn()
    const { getByTestId } = await render(
      <Entry {...defaultProps} onSetPriority={onSetPriority} />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-priority-1"))
    await fireEvent.press(
      getByTestId(`entry-priority-picker-1-option-${Priority.DAYS_4_PLUS}`)
    )
    await fireEvent.press(getByTestId("entry-priority-picker-1-apply"))

    expect(onSetPriority).toHaveBeenCalledWith(Priority.DAYS_4_PLUS)
  })

  it("calls onClearPriority when None is picked and applied", async () => {
    const onClearPriority = jest.fn()
    const { getByTestId } = await render(
      <Entry
        {...defaultProps}
        priority={Priority.NOW}
        onClearPriority={onClearPriority}
      />
    )

    await fireEvent(getByTestId("entry-component-1"), "longPress")
    await fireEvent.press(getByTestId("entry-context-priority-1"))
    await fireEvent.press(getByTestId("entry-priority-picker-1-none"))
    await fireEvent.press(getByTestId("entry-priority-picker-1-apply"))

    expect(onClearPriority).toHaveBeenCalledTimes(1)
  })
})
