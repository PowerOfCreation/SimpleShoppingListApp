import * as React from "react"
import { screen, render } from "@testing-library/react-native"
import Index from ".."
import { ingredientService } from "@/api/ingredient-service"

it("displays missing entries information when no products are added", async () => {
  render(<Index />)

  const missingEntriesInfoText = await screen.findByText(
    "Press the '+' button at the bottom right to add your first product."
  )

  expect(missingEntriesInfoText).toBeOnTheScreen()
})

it("don't displays missing entries information when products are added", async () => {
  ingredientService.AddIngredients("Foo")

  render(<Index />)

  const missingEntriesInfoText = await screen.findByText(
    "Press the '+' button at the bottom right to add your first product."
  )

  expect(missingEntriesInfoText).not.toBeOnTheScreen()
})
