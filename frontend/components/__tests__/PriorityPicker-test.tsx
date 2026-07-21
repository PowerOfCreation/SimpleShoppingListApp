import * as React from "react"
import { render, fireEvent } from "@testing-library/react-native"
import { PriorityPicker, PriorityPickerProps } from "../PriorityPicker"
import { Priority } from "@/types/Priority"

const defaultProps: PriorityPickerProps = {
  visible: true,
  title: "Milk",
  currentPriority: undefined,
  onClose: jest.fn(),
  onApply: jest.fn(),
}

describe("PriorityPicker", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("renders all priority options and a None option", () => {
    const { getByText } = render(<PriorityPicker {...defaultProps} />)

    expect(getByText("Now")).toBeTruthy()
    expect(getByText("1-3 days")).toBeTruthy()
    expect(getByText("4+ days")).toBeTruthy()
    expect(getByText("None")).toBeTruthy()
  })

  it("shows the ingredient name as subtitle", () => {
    const { getByText } = render(<PriorityPicker {...defaultProps} />)

    expect(getByText("Milk")).toBeTruthy()
  })

  it("calls onApply with the selected priority and closes when Apply is pressed", () => {
    const onApply = jest.fn()
    const onClose = jest.fn()
    const { getByTestId } = render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        onApply={onApply}
        onClose={onClose}
      />
    )

    fireEvent.press(
      getByTestId(`priority-picker-option-${Priority.DAYS_1_TO_3}`)
    )
    fireEvent.press(getByTestId("priority-picker-apply"))

    expect(onApply).toHaveBeenCalledWith(Priority.DAYS_1_TO_3)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("calls onApply with undefined when None is selected and applied", () => {
    const onApply = jest.fn()
    const { getByTestId } = render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        currentPriority={Priority.NOW}
        onApply={onApply}
      />
    )

    fireEvent.press(getByTestId("priority-picker-none"))
    fireEvent.press(getByTestId("priority-picker-apply"))

    expect(onApply).toHaveBeenCalledWith(undefined)
  })

  it("does not call onApply when Cancel is pressed", () => {
    const onApply = jest.fn()
    const onClose = jest.fn()
    const { getByTestId } = render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        onApply={onApply}
        onClose={onClose}
      />
    )

    fireEvent.press(getByTestId(`priority-picker-option-${Priority.NOW}`))
    fireEvent.press(getByTestId("priority-picker-cancel"))

    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("resets selection to currentPriority when reopened", () => {
    const onApply = jest.fn()
    const { getByTestId, rerender } = render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        currentPriority={Priority.NOW}
        visible={false}
        onApply={onApply}
      />
    )

    rerender(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        currentPriority={Priority.NOW}
        visible={true}
        onApply={onApply}
      />
    )

    fireEvent.press(getByTestId("priority-picker-apply"))

    expect(onApply).toHaveBeenCalledWith(Priority.NOW)
  })
})
