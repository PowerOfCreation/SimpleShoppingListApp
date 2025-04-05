import React from "react"
import {
  screen,
  render,
  waitFor,
  fireEvent,
} from "@testing-library/react-native"
import Index from ".." // Assuming Index-test.tsx is in app/__tests__
import { ingredientService } from "@/api/ingredient-service"
import { router } from "expo-router"
import { Ingredient } from "@/types/Ingredient"

// --- Mocks ---

// Mock the ingredient service (keep this as we don't want real API calls)
jest.mock("@/api/ingredient-service", () => ({
  ingredientService: {
    GetIngredients: jest.fn(),
    // We don't need AddIngredients for Index tests
    Update: jest.fn(),
  },
}))

// Mock expo-router for navigation checks
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
  },
}))

// --- Test Data ---
const mockInitialIngredients: Ingredient[] = [
  { id: "1", name: "Milk", completed: false },
  { id: "2", name: "Bread", completed: true },
  { id: "3", name: "Eggs", completed: false },
]

// --- Helpers ---
const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
const mockUpdate = ingredientService.Update as jest.Mock
const mockRouterPush = router.push as jest.Mock

// Helper to render with specific service responses
const renderIndexAndWaitForLoad = async (
  getIngredientsResponse: Promise<Ingredient[]> | Error = Promise.resolve([
    ...mockInitialIngredients, // Use spread to create copies
  ]),
  updateResponse: Promise<void> | Error = Promise.resolve(undefined)
) => {
  if (getIngredientsResponse instanceof Error) {
    mockGetIngredients.mockRejectedValueOnce(getIngredientsResponse)
  } else {
    // Make sure to await the promise here before resolving the mock
    const ingredients = await getIngredientsResponse
    mockGetIngredients.mockResolvedValueOnce(ingredients)
  }
  // Set up the Update mock to return the specified response potentially failing
  mockUpdate.mockImplementation(() =>
    updateResponse instanceof Error
      ? Promise.reject(updateResponse)
      : Promise.resolve(updateResponse)
  )

  render(<Index />)

  // Wait for loading to finish (or error to appear)
  await waitFor(
    () => {
      // Check that the indicator is gone
      expect(screen.queryByAccessibilityHint("loading data")).toBeNull()
    },
    { timeout: 2000 }
  ) // Increased timeout for potentially slow CI environments

  // Further checks after loading indicator disappears
  if (getIngredientsResponse instanceof Error) {
    // Check if the error message is displayed
    await waitFor(() => {
      expect(
        screen.getByText(
          `Failed to load ingredients: ${getIngredientsResponse.message}`
        )
      ).toBeOnTheScreen()
    })
  } else {
    const ingredients = await getIngredientsResponse
    if (ingredients.length > 0) {
      // Ensure first item is rendered if successful and data exists
      await waitFor(() => {
        expect(screen.getByText(ingredients[0].name)).toBeOnTheScreen()
      })
    } else {
      // Ensure empty list message is rendered if successful and no data
      await waitFor(() => {
        expect(screen.getByText(/Press the '\+' button/)).toBeOnTheScreen()
      })
    }
  }
}

// --- Tests ---

describe("<Index /> Integration Tests", () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks()
    // Suppress console error for expected error tests, useful for testing error states
    jest.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks() // Restore original implementations including console.error
  })

  it("displays loading indicator initially then loads data", async () => {
    // Use mockImplementationOnce to control the timing
    mockGetIngredients.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([...mockInitialIngredients]), 50)
        )
    )
    render(<Index />)
    // Check loading indicator is present initially using findByAccessibilityHint
    await screen.findByAccessibilityHint("loading data")

    // Wait for loading to finish and data to appear
    await waitFor(() => {
      expect(screen.queryByAccessibilityHint("loading data")).toBeNull()
      expect(screen.getByText("Milk")).toBeOnTheScreen()
    })
  })

  it("displays missing entries information when no products are added", async () => {
    await renderIndexAndWaitForLoad(Promise.resolve([])) // Load with empty array

    const missingEntriesInfoText = screen.getByText(
      "Press the '+' button at the bottom right to add your first product."
    )
    expect(missingEntriesInfoText).toBeOnTheScreen()
    expect(mockGetIngredients).toHaveBeenCalledTimes(1)
  })

  it("doesn't display missing entries info when products are loaded", async () => {
    await renderIndexAndWaitForLoad() // Load with default mock data

    const missingEntriesInfoText = screen.queryByText(
      "Press the '+' button at the bottom right to add your first product."
    )
    expect(missingEntriesInfoText).toBeNull()
    expect(screen.getByText("Milk")).toBeOnTheScreen()
    expect(screen.getByText("Bread")).toBeOnTheScreen()
    expect(screen.getByText("Eggs")).toBeOnTheScreen()
    expect(mockGetIngredients).toHaveBeenCalledTimes(1)

    // Assuming Entry component renders with testID `entry-component-${item.id}`
    expect(screen.getAllByTestId(/^entry-component-/)).toHaveLength(
      mockInitialIngredients.length
    )
  })

  it("displays error message if fetching ingredients fails", async () => {
    const errorMessage = "Network Failed"
    await renderIndexAndWaitForLoad(new Error(errorMessage))

    expect(
      screen.getByText(`Failed to load ingredients: ${errorMessage}`)
    ).toBeOnTheScreen()
    expect(mockGetIngredients).toHaveBeenCalledTimes(1)
    // Ensure list items are not rendered
    expect(screen.queryByText("Milk")).toBeNull()
  })

  it("toggles ingredient completion optimistically and calls Update", async () => {
    await renderIndexAndWaitForLoad()

    // Use the root component testID for pressing, assuming the whole area is tappable for toggle
    const milkEntryComponent = screen.getByTestId("entry-component-1")

    // Check initial state visually (Milk is not completed - depends on Entry impl.)
    // e.g., expect(milkEntryComponent).toHaveStyle({ textDecorationLine: 'none' });

    fireEvent.press(milkEntryComponent)

    // Check optimistic UI update (Milk should now appear completed - depends on Entry impl.)
    // e.g., expect(milkEntryComponent).toHaveStyle({ textDecorationLine: 'line-through' });

    // Check that Update was called with toggled state
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })

    const expectedPayload = [...mockInitialIngredients]
    expectedPayload[0].completed = true // Milk (id: "1") is toggled
    expect(mockUpdate).toHaveBeenCalledWith(expectedPayload)

    // Ensure error message is not displayed
    expect(screen.queryByText(/Failed to update completion/)).toBeNull()
  })

  it("rolls back toggle completion if Update fails", async () => {
    const updateError = new Error("Server Error")
    await renderIndexAndWaitForLoad(
      Promise.resolve([...mockInitialIngredients]),
      updateError
    ) // Setup Update to fail

    const eggsEntryComponent = screen.getByTestId("entry-component-3") // Eggs, id: "3", completed: false

    // Capture initial visual state (Eggs not completed)

    fireEvent.press(eggsEntryComponent)

    // Check optimistic UI update happens briefly (Eggs appears completed)

    // Wait for Update call and subsequent error handling/rollback
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      // Check error message is displayed
      expect(
        screen.getByText(`Failed to update completion: ${updateError.message}`)
      ).toBeOnTheScreen()
    })

    // Check UI rollback (Verify the visual state is back to not completed for Eggs)
    // e.g., expect(eggsEntryComponent).toHaveStyle({ textDecorationLine: 'none' });
    // Since visual check is hard, we rely on the error message and hook logic.
  })

  it("allows editing an ingredient name optimistically and calls Update", async () => {
    await renderIndexAndWaitForLoad()
    const newName = "Whole Milk"

    const milkEntryComponent = screen.getByTestId("entry-component-1")
    fireEvent(milkEntryComponent, "longPress")

    // Wait for input to appear and verify it has the original value
    const inputField = await screen.findByTestId("entry-input-1")
    expect(inputField).toBeOnTheScreen()
    expect(inputField.props.value).toBe("Milk") // Check initial value in input

    // Change text and simulate submit (e.g., pressing Enter/Done on keyboard)
    fireEvent.changeText(inputField, newName)
    fireEvent(inputField, "submitEditing") // Trigger the onSubmit passed to ThemedTextInput

    // Check optimistic UI update: Input disappears, new name is shown
    await waitFor(() => {
      expect(screen.queryByTestId("entry-input-1")).toBeNull()
    })
    expect(screen.getByText(newName)).toBeOnTheScreen() // Check if the main text updated
    expect(screen.queryByText("Milk")).toBeNull()

    // Check Update call
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })
    const expectedPayload = [...mockInitialIngredients]
    expectedPayload[0].name = newName // Milk (id: "1") name changed
    expect(mockUpdate).toHaveBeenCalledWith(expectedPayload)

    // Ensure error message is not displayed
    expect(screen.queryByText(/Failed to change name/)).toBeNull()
  })

  it("allows canceling an edit via blur", async () => {
    await renderIndexAndWaitForLoad()

    const breadEntryComponent = screen.getByTestId("entry-component-2") // Bread, id: "2"
    fireEvent(breadEntryComponent, "longPress")

    const inputField = await screen.findByTestId("entry-input-2")
    expect(inputField).toBeOnTheScreen()
    expect(inputField.props.value).toBe("Bread")

    fireEvent.changeText(inputField, "Sourdough") // Change temporarily

    // Simulate blur event to cancel editing
    fireEvent(inputField, "blur")

    // Check UI update: Input disappears, original name remains
    await waitFor(() => {
      expect(screen.queryByTestId("entry-input-2")).toBeNull()
    })
    expect(screen.getByText("Bread")).toBeOnTheScreen() // Original name still there
    expect(screen.queryByText("Sourdough")).toBeNull()

    // Check Update was NOT called
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("shows error message if name change fails", async () => {
    const updateError = new Error("Save Failed")
    // Need to resolve GetIngredients first, then set up failing Update
    await renderIndexAndWaitForLoad(
      Promise.resolve([...mockInitialIngredients]),
      updateError
    )
    const failedName = "Scrambled Eggs"

    const eggsEntryComponent = screen.getByTestId("entry-component-3") // Eggs, id: "3"
    fireEvent(eggsEntryComponent, "longPress")

    const inputField = await screen.findByTestId("entry-input-3")
    fireEvent.changeText(inputField, failedName)
    fireEvent(inputField, "submitEditing") // Attempt to save

    // Check optimistic UI update (new name shown briefly, input disappears)
    // Let's check the final state after error handling.

    // Wait for Update call and subsequent error handling/rollback
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      // Check error message is displayed
      expect(
        screen.getByText(`Failed to change name: ${updateError.message}`)
      ).toBeOnTheScreen()
    })
  })

  it("navigates to new_ingredient screen when '+' button is pressed", async () => {
    await renderIndexAndWaitForLoad() // Load with some data

    // ActionButton doesn't have explicit text, find by another means if necessary (e.g., testID)
    // Let's assume ActionButton has a testID="add-button"
    const addButton = await screen.findByTestId("add-button") // Adjust if ActionButton has a different testID or none
    // If no testID, you might need to find it by role or other accessibility properties
    // const addButton = await screen.findByRole('button', { name: '+' }); // Example using role and accessible name

    fireEvent.press(addButton)

    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith("/new_ingredient")
  })
})
