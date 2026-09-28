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

  it("renders all priority options and a None option", async () => {
    const { getByText } = await render(<PriorityPicker {...defaultProps} />)

    expect(getByText("Now")).toBeTruthy()
    expect(getByText("1-3 days")).toBeTruthy()
    expect(getByText("4+ days")).toBeTruthy()
    expect(getByText("None")).toBeTruthy()
  })

  it("shows the ingredient name as subtitle", async () => {
    const { getByText } = await render(<PriorityPicker {...defaultProps} />)

    expect(getByText("Milk")).toBeTruthy()
  })

  it("calls onApply with the selected priority and closes when Apply is pressed", async () => {
    const onApply = jest.fn()
    const onClose = jest.fn()
    const { getByTestId } = await render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        onApply={onApply}
        onClose={onClose}
      />
    )

    await fireEvent.press(
      getByTestId(`priority-picker-option-${Priority.DAYS_1_TO_3}`)
    )
    await fireEvent.press(getByTestId("priority-picker-apply"))

    expect(onApply).toHaveBeenCalledWith(Priority.DAYS_1_TO_3)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("calls onApply with undefined when None is selected and applied", async () => {
    const onApply = jest.fn()
    const { getByTestId } = await render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        currentPriority={Priority.NOW}
        onApply={onApply}
      />
    )

    await fireEvent.press(getByTestId("priority-picker-none"))
    await fireEvent.press(getByTestId("priority-picker-apply"))

    expect(onApply).toHaveBeenCalledWith(undefined)
  })

  it("does not call onApply when Cancel is pressed", async () => {
    const onApply = jest.fn()
    const onClose = jest.fn()
    const { getByTestId } = await render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        onApply={onApply}
        onClose={onClose}
      />
    )

    await fireEvent.press(getByTestId(`priority-picker-option-${Priority.NOW}`))
    await fireEvent.press(getByTestId("priority-picker-cancel"))

    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("resets selection to currentPriority when reopened", async () => {
    const onApply = jest.fn()
    const { getByTestId, rerender } = await render(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        currentPriority={Priority.NOW}
        visible={false}
        onApply={onApply}
      />
    )

    await rerender(
      <PriorityPicker
        {...defaultProps}
        testID="priority-picker"
        currentPriority={Priority.NOW}
        visible={true}
        onApply={onApply}
      />
    )

    await fireEvent.press(getByTestId("priority-picker-apply"))

    expect(onApply).toHaveBeenCalledWith(Priority.NOW)
  })
})
