import React from "react"
import {
  screen,
  render,
  waitFor,
  fireEvent,
} from "@testing-library/react-native"
import Index from ".."
import { router } from "expo-router"
import { Ingredient } from "@/types/Ingredient"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { useIngredientsStore } from "@/store/ingredientStore"

// --- Mocks ---

// Mock expo-router for navigation
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
  },
}))

// Mock the store
jest.mock("@/store/ingredientStore")

const mockUseIngredientsStore = useIngredientsStore as unknown as jest.Mock

// --- Test Data ---
const mockInitialIngredients: Ingredient[] = [
  { id: "1", name: "Milk", completed: false },
  { id: "2", name: "Bread", completed: true },
  { id: "3", name: "Eggs", completed: false },
]

// --- Helpers ---
const mockRouterPush = router.push as jest.Mock

/**
 * Helper to set up the store mock with specific state
 */
const setupStoreMock = (
  ingredients: Ingredient[] = mockInitialIngredients,
  isLoading: boolean = false,
  error: string | null = null,
  toggleFn: jest.Mock = jest.fn().mockResolvedValue(undefined),
  changeFn: jest.Mock = jest.fn().mockResolvedValue(undefined)
) => {
  mockUseIngredientsStore.mockImplementation((selector) => {
    if (typeof selector === "function") {
      return selector({
        ingredients,
        isLoading,
        error,
        initialized: true,
        initialize: jest.fn(),
        toggleIngredientCompletion: toggleFn,
        changeIngredientName: changeFn,
        clearError: jest.fn(),
      })
    }
    return {
      ingredients,
      isLoading,
      error,
      initialized: true,
      initialize: jest.fn(),
      toggleIngredientCompletion: toggleFn,
      changeIngredientName: changeFn,
      clearError: jest.fn(),
    }
  })
}

// --- Tests ---

describe("<Index /> Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("displays loading indicator when loading", () => {
    setupStoreMock([], true, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(screen.getByAccessibilityHint("loading data")).toBeOnTheScreen()
  })

  it("displays ingredients after loading", () => {
    setupStoreMock(mockInitialIngredients, false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(screen.queryByAccessibilityHint("loading data")).toBeNull()
    expect(screen.getByText("Milk")).toBeOnTheScreen()
    expect(screen.getByText("Bread")).toBeOnTheScreen()
    expect(screen.getByText("Eggs")).toBeOnTheScreen()
  })

  it("displays missing entries information when no products are added", () => {
    setupStoreMock([], false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(
      screen.getByText(
        "Press the '+' button at the bottom right to add your first product."
      )
    ).toBeOnTheScreen()
    expect(screen.queryByText("Milk")).toBeNull()
  })

  it("displays error message if fetching ingredients fails", () => {
    const errorMessage = "Network Failed"
    setupStoreMock([], false, `Failed to load ingredients: ${errorMessage}`)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(
      screen.getByText(`Failed to load ingredients: ${errorMessage}`)
    ).toBeOnTheScreen()
    expect(screen.queryByText("Milk")).toBeNull()
  })

  it("renders all ingredients with testID", () => {
    setupStoreMock(mockInitialIngredients, false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(screen.getByTestId("entry-component-1")).toBeOnTheScreen()
    expect(screen.getByTestId("entry-component-2")).toBeOnTheScreen()
    expect(screen.getByTestId("entry-component-3")).toBeOnTheScreen()
  })

  it("toggles ingredient completion optimistically and calls store action", async () => {
    const mockToggle = jest.fn().mockResolvedValue(undefined)
    setupStoreMock(mockInitialIngredients, false, null, mockToggle)

    render(<Index />, { wrapper: SafeAreaProvider })

    const milkEntryComponent = screen.getByTestId("entry-component-1")
    fireEvent.press(milkEntryComponent)

    await waitFor(() => {
      expect(mockToggle).toHaveBeenCalledWith("1")
    })

    expect(screen.queryByText(/Failed to update completion/)).toBeNull()
  })

  it("displays error if toggle completion fails", async () => {
    const mockToggle = jest.fn().mockResolvedValue(undefined)
    setupStoreMock(mockInitialIngredients, false, null, mockToggle)

    render(<Index />, { wrapper: SafeAreaProvider })

    const eggsEntryComponent = screen.getByTestId("entry-component-3")
    fireEvent.press(eggsEntryComponent)

    await waitFor(() => {
      expect(mockToggle).toHaveBeenCalled()
    })
  })

  it("allows editing an ingredient name and calls store action", async () => {
    const mockChangeName = jest.fn().mockResolvedValue(undefined)
    setupStoreMock(
      mockInitialIngredients,
      false,
      null,
      jest.fn(),
      mockChangeName
    )

    render(<Index />, { wrapper: SafeAreaProvider })

    const milkEntryComponent = screen.getByTestId("entry-component-1")
    fireEvent(milkEntryComponent, "longPress")

    const inputField = await screen.findByTestId("entry-input-1")
    expect(inputField).toBeOnTheScreen()

    const newName = "Whole Milk"
    fireEvent.changeText(inputField, newName)

    fireEvent(inputField, "submitEditing")

    await waitFor(() => {
      expect(mockChangeName).toHaveBeenCalledWith("1", newName)
    })

    expect(screen.queryByTestId("entry-input-1")).toBeNull()
  })

  it("allows canceling an edit via blur", async () => {
    const mockChangeName = jest.fn()
    setupStoreMock(
      mockInitialIngredients,
      false,
      null,
      jest.fn(),
      mockChangeName
    )

    render(<Index />, { wrapper: SafeAreaProvider })

    const milkEntryComponent = screen.getByTestId("entry-component-1")
    fireEvent(milkEntryComponent, "longPress")

    const inputField = await screen.findByTestId("entry-input-1")

    const newName = "Whole Milk"
    fireEvent.changeText(inputField, newName)

    fireEvent(inputField, "blur")

    expect(mockChangeName).not.toHaveBeenCalled()
    expect(screen.queryByTestId("entry-input-1")).toBeNull()
  })

  it("shows error message if name change fails", async () => {
    const mockChangeName = jest.fn().mockResolvedValue(undefined)
    setupStoreMock(
      mockInitialIngredients,
      false,
      null,
      jest.fn(),
      mockChangeName
    )

    render(<Index />, { wrapper: SafeAreaProvider })

    const milkEntryComponent = screen.getByTestId("entry-component-1")
    fireEvent(milkEntryComponent, "longPress")

    const inputField = await screen.findByTestId("entry-input-1")
    const newName = "Whole Milk"

    fireEvent.changeText(inputField, newName)
    fireEvent(inputField, "submitEditing")

    await waitFor(() => {
      expect(mockChangeName).toHaveBeenCalledWith("1", newName)
    })
  })

  it("navigates to new_ingredient screen when '+' button is pressed", () => {
    setupStoreMock(mockInitialIngredients, false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    const addButton = screen.getByTestId("add-button")
    fireEvent.press(addButton)

    expect(mockRouterPush).toHaveBeenCalledWith("/new_ingredient")
  })

  it("updates the display when ingredients state changes", () => {
    const { rerender } = render(<Index />, { wrapper: SafeAreaProvider })

    setupStoreMock(mockInitialIngredients, false, null)
    rerender(<Index />)

    expect(screen.getByText("Milk")).toBeOnTheScreen()
    expect(screen.getByText("Bread")).toBeOnTheScreen()

    // Now change the ingredients
    setupStoreMock(
      [
        { id: "1", name: "Milk", completed: false },
        { id: "4", name: "Cheese", completed: false },
      ],
      false,
      null
    )
    rerender(<Index />)

    expect(screen.getByText("Milk")).toBeOnTheScreen()
    expect(screen.getByText("Cheese")).toBeOnTheScreen()
    expect(screen.queryByText("Bread")).toBeNull()
  })
})
