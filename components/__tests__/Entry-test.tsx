import * as React from "react"
import { render } from "@testing-library/react-native"
import { Entry } from "../Entry"

it(`renders correctly`, () => {
  const { toJSON } = render(
    <Entry
      ingredientName={""}
      isCompleted={false}
      onToggleComplete={() => {}}
    />
  )

  expect(toJSON()).toMatchSnapshot()
})

it("applies correct style when isCompleted is true", () => {
  const { getByText } = render(
    <Entry
      ingredientName={"Tomato"}
      isCompleted={true}
      onToggleComplete={() => {}}
    />
  )

  const entryText = getByText("Tomato")

  expect(entryText).toHaveStyle({
    textDecorationLine: "line-through",
  })
})

it("applies correct style when isCompleted is false", () => {
  const { getByText } = render(
    <Entry
      ingredientName={"Tomato"}
      isCompleted={false}
      onToggleComplete={() => {}}
    />
  )

  const entryText = getByText("Tomato")

  expect(entryText).toHaveStyle({
    color: "white",
    textDecorationLine: "none",
  })
})
