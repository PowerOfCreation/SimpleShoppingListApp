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
import { useIngredients } from "@/hooks/useIngredients"

// --- Mocks ---

// Mock expo-router
jest.mock("expo-router", () => {
  const React = require("react")
  return {
    router: {
      push: jest.fn(),
    },
    useFocusEffect: (callback: () => void) => {
      React.useEffect(() => {
        callback()
      }, [callback])
    },
  }
})

// Mock the hook
jest.mock("@/hooks/useIngredients")

// --- Test Data ---
const mockInitialIngredients: Ingredient[] = [
  {
    id: "1",
    name: "Milk",
    completed: false,
    created_at: 1000,
    updated_at: 1000,
  },
  {
    id: "2",
    name: "Bread",
    completed: true,
    created_at: 2000,
    updated_at: 2000,
  },
  {
    id: "3",
    name: "Eggs",
    completed: false,
    created_at: 3000,
    updated_at: 3000,
  },
]

// --- Helpers ---
const mockUseIngredients = useIngredients as jest.MockedFunction<
  typeof useIngredients
>
const mockRouterPush = router.push as jest.Mock

const setupHookMock = (
  ingredients: Ingredient[] = mockInitialIngredients,
  isLoading: boolean = false,
  error: string | null = null,
  refetch: jest.Mock = jest.fn()
) => {
  mockUseIngredients.mockReturnValue({
    ingredients,
    isLoading,
    error,
    refetch,
  })
}

// --- Tests ---

describe("<Index /> Component Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("displays loading indicator when loading", () => {
    setupHookMock([], true, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(screen.getByAccessibilityHint("loading data")).toBeOnTheScreen()
  })

  it("displays ingredients after loading", () => {
    setupHookMock(mockInitialIngredients, false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(screen.queryByAccessibilityHint("loading data")).toBeNull()
    expect(screen.getByText("Milk")).toBeOnTheScreen()
    expect(screen.getByText("Bread")).toBeOnTheScreen()
    expect(screen.getByText("Eggs")).toBeOnTheScreen()
  })

  it("displays empty state when no products", () => {
    setupHookMock([], false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(
      screen.getByText(
        "Press the '+' button at the bottom right to add your first product."
      )
    ).toBeOnTheScreen()
  })

  it("displays error message when loading fails", () => {
    const errorMsg = "Network error"
    setupHookMock([], false, errorMsg)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(screen.getByText(errorMsg)).toBeOnTheScreen()
  })

  it("renders all ingredients with testID", () => {
    setupHookMock(mockInitialIngredients, false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    expect(screen.getByTestId("entry-component-1")).toBeOnTheScreen()
    expect(screen.getByTestId("entry-component-2")).toBeOnTheScreen()
    expect(screen.getByTestId("entry-component-3")).toBeOnTheScreen()
  })

  it("toggles ingredient completion when entry pressed", () => {
    setupHookMock(mockInitialIngredients, false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    const milkEntry = screen.getByTestId("entry-component-1")
    fireEvent.press(milkEntry)

    // Component should handle the toggle
    expect(screen.getByText("Milk")).toBeOnTheScreen()
  })

  it("navigates to new_ingredient screen when add button pressed", () => {
    setupHookMock(mockInitialIngredients, false, null)
    render(<Index />, { wrapper: SafeAreaProvider })

    const addButton = screen.getByTestId("add-button")
    fireEvent.press(addButton)

    expect(mockRouterPush).toHaveBeenCalledWith("/new_ingredient")
  })

  it("calls refetch on screen focus", () => {
    const mockRefetch = jest.fn()
    setupHookMock(mockInitialIngredients, false, null, mockRefetch)

    render(<Index />, { wrapper: SafeAreaProvider })

    // useFocusEffect should call refetch
    expect(mockRefetch).toHaveBeenCalled()
  })
})
