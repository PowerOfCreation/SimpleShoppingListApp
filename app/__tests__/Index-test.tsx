import * as React from "react"
import { screen, render, waitFor } from "@testing-library/react-native"
import Index from ".."
import { ingredientService } from "@/api/ingredient-service"

// Mock the ingredient service
jest.mock("@/api/ingredient-service", () => ({
  ingredientService: {
    GetIngredients: jest.fn().mockResolvedValue([]),
    AddIngredients: jest.fn().mockResolvedValue({ isSuccessful: true, error: "" }),
    Update: jest.fn().mockResolvedValue(undefined),
  },
}))

it("displays missing entries information when no products are added", async () => {
  // Setup mock to return empty array
  (ingredientService.GetIngredients as jest.Mock).mockResolvedValue([])

  render(<Index />)

  const missingEntriesInfoText = await screen.findByText(
    "Press the '+' button at the bottom right to add your first product."
  )

  expect(missingEntriesInfoText).toBeOnTheScreen()
})

it("doesn't display missing entries information when products are added", async () => {
  // Setup mock to return an array with one ingredient
  (ingredientService.GetIngredients as jest.Mock).mockResolvedValue([
    { id: "1", name: "Foo", completed: false }
  ])

  const { queryByText } = render(<Index />)

  // Wait for ingredients to load
  await waitFor(() => {
    expect(ingredientService.GetIngredients).toHaveBeenCalled()
  })

  // Check that the missing entries text is not present
  const missingEntriesInfoText = queryByText(
    "Press the '+' button at the bottom right to add your first product."
  )

  expect(missingEntriesInfoText).toBeNull()
})
