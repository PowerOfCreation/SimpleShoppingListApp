import * as React from "react"
import { render } from "@testing-library/react-native"
import { Entry, EntryProps } from "../Entry"

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
}

it(`renders correctly`, () => {
  const { toJSON } = render(<Entry {...defaultProps} ingredientName={""} />)

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
