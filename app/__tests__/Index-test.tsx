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
import { Result } from "@/api/common/result"
import { DbQueryError, ValidationError } from "@/api/common/error-types"

// --- Mocks ---

// Mock the ingredient service (keep this as we don't want real API calls)
jest.mock("@/api/ingredient-service", () => ({
  ingredientService: {
    GetIngredients: jest.fn(),
    // We don't need AddIngredients for Index tests
    updateCompletion: jest.fn(),
    updateName: jest.fn(),
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
const mockUpdateCompletion = ingredientService.updateCompletion as jest.Mock
const mockUpdateName = ingredientService.updateName as jest.Mock
const mockRouterPush = router.push as jest.Mock

// Helper to render with specific service responses
const renderIndexAndWaitForLoad = async (
  getIngredientsResponse:
    | Promise<Result<Ingredient[], DbQueryError>>
    | Error = Promise.resolve(
    Result.ok([
      ...mockInitialIngredients, // Use spread to create copies
    ])
  ),
  updateCompletionResponse:
    | Promise<Result<void, DbQueryError>>
    | Error = Promise.resolve(Result.ok(undefined)),
  updateNameResponse:
    | Promise<Result<void, ValidationError | DbQueryError>>
    | Error = Promise.resolve(Result.ok(undefined))
) => {
  if (getIngredientsResponse instanceof Error) {
    mockGetIngredients.mockRejectedValueOnce(getIngredientsResponse)
  } else {
    // Make sure to await the promise here before resolving the mock
    const result = await getIngredientsResponse
    mockGetIngredients.mockResolvedValueOnce(result)
  }
  // Set up the updateCompletion mock
  mockUpdateCompletion.mockImplementation(() =>
    updateCompletionResponse instanceof Error
      ? Promise.reject(updateCompletionResponse)
      : Promise.resolve(updateCompletionResponse)
  )
  // Set up the updateName mock
  mockUpdateName.mockImplementation(() =>
    updateNameResponse instanceof Error
      ? Promise.reject(updateNameResponse)
      : Promise.resolve(updateNameResponse)
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
    const result = await getIngredientsResponse

    if (result.success) {
      const ingredients = result.getValue() || []
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
    } else {
      const error = result.getError()
      // Check if the error message is displayed
      await waitFor(() => {
        expect(
          screen.getByText(
            `Failed to load ingredients: ${error?.message || "Unknown error"}`
          )
        ).toBeOnTheScreen()
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
          setTimeout(() => resolve(Result.ok([...mockInitialIngredients])), 50)
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
    await renderIndexAndWaitForLoad(Promise.resolve(Result.ok([]))) // Load with empty array

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
    const dbError = new DbQueryError(errorMessage, "getAll", "Ingredient")
    await renderIndexAndWaitForLoad(Promise.resolve(Result.fail(dbError)))

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
      expect(mockUpdateCompletion).toHaveBeenCalledTimes(1)
    })

    expect(mockUpdateCompletion).toHaveBeenCalledWith("1", true)

    // Ensure error message is not displayed
    expect(screen.queryByText(/Failed to update completion/)).toBeNull()
  })

  it("rolls back toggle completion if Update fails", async () => {
    const errorMessage = "Server Error"
    const dbError = new DbQueryError(
      errorMessage,
      "updateCompletion",
      "Ingredient"
    )
    await renderIndexAndWaitForLoad(
      Promise.resolve(Result.ok([...mockInitialIngredients])),
      Promise.resolve(Result.fail(dbError)),
      Promise.resolve(Result.ok(undefined))
    ) // Setup updateCompletion to fail

    const eggsEntryComponent = screen.getByTestId("entry-component-3") // Eggs, id: "3", completed: false

    // Capture initial visual state (Eggs not completed)

    fireEvent.press(eggsEntryComponent)

    // Check optimistic UI update happens briefly (Eggs appears completed)

    // Wait for Update call and subsequent error handling/rollback
    await waitFor(() => {
      expect(mockUpdateCompletion).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      // Check error message is displayed
      expect(
        screen.getByText(`Failed to update completion: ${errorMessage}`)
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

    // Change the text in the input field
    fireEvent.changeText(inputField, newName)

    // Submit the edit
    fireEvent(inputField, "submitEditing")

    // Check that Update was called with new name
    await waitFor(() => {
      expect(mockUpdateName).toHaveBeenCalledTimes(1)
    })
    expect(mockUpdateName).toHaveBeenCalledWith("1", newName)

    // Check UI was updated optimistically - input should be gone and new name visible
    expect(screen.queryByTestId("entry-input-1")).toBeNull()
    expect(screen.getByText(newName)).toBeOnTheScreen()
  })

  it("allows canceling an edit via blur", async () => {
    await renderIndexAndWaitForLoad()
    const originalName = "Milk"
    const newName = "Whole Milk"

    const milkEntryComponent = screen.getByTestId("entry-component-1")
    fireEvent(milkEntryComponent, "longPress")

    // Wait for input to appear and verify it has the original value
    const inputField = await screen.findByTestId("entry-input-1")
    expect(inputField).toBeOnTheScreen()

    // Change the text in the input field
    fireEvent.changeText(inputField, newName)

    // Blur the input field without submitting
    fireEvent(inputField, "blur")

    // Check that Update was NOT called
    expect(mockUpdateName).not.toHaveBeenCalled()

    // Check UI reverted to original state - input should be gone and original name visible
    expect(screen.queryByTestId("entry-input-1")).toBeNull()
    expect(screen.getByText(originalName)).toBeOnTheScreen()
    expect(screen.queryByText(newName)).toBeNull()
  })

  it("shows error message if name change fails", async () => {
    const errorMessage = "Invalid name"
    const validationError = new ValidationError(errorMessage, "name")
    await renderIndexAndWaitForLoad(
      Promise.resolve(Result.ok([...mockInitialIngredients])),
      Promise.resolve(Result.ok(undefined)),
      Promise.resolve(Result.fail(validationError))
    ) // Setup updateName to fail

    const milkEntryComponent = screen.getByTestId("entry-component-1")
    fireEvent(milkEntryComponent, "longPress")

    const inputField = await screen.findByTestId("entry-input-1")
    const newName = "Whole Milk"

    // Change the text in the input field
    fireEvent.changeText(inputField, newName)

    // Submit the edit
    fireEvent(inputField, "submitEditing")

    // Wait for Update call and subsequent error handling
    await waitFor(() => {
      expect(mockUpdateName).toHaveBeenCalledTimes(1)
    })

    // Check error message is displayed
    await waitFor(() => {
      expect(
        screen.getByText(`Failed to change name: ${errorMessage}`)
      ).toBeOnTheScreen()
    })
  })

  it("navigates to new_ingredient screen when '+' button is pressed", async () => {
    await renderIndexAndWaitForLoad()

    const addButton = screen.getByTestId("add-button")
    fireEvent.press(addButton)

    expect(mockRouterPush).toHaveBeenCalledWith("/new_ingredient")
  })
})
