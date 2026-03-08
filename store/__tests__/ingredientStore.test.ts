import { renderHook, act, waitFor } from "@testing-library/react-native"
import { useIngredientsStore } from "../ingredientStore"
import { Ingredient } from "@/types/Ingredient"
import { Result } from "@/api/common/result"
import { DbQueryError, ValidationError } from "@/api/common/error-types"

import { ingredientService } from "@/api/ingredient-service"

// Mock the ingredient service
jest.mock("@/api/ingredient-service", () => ({
  ingredientService: {
    GetIngredients: jest.fn(),
    AddIngredients: jest.fn(),
    updateCompletion: jest.fn(),
    updateName: jest.fn(),
  },
}))

// Mock the repository
jest.mock("@/database/ingredient-repository")

// Test data
const mockIngredients: Ingredient[] = [
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

describe("useIngredientsStore", () => {
  beforeEach(() => {
    // Reset the store before each test
    useIngredientsStore.setState({
      ingredients: [],
      isLoading: false,
      error: null,
      initialized: false,
    })
    jest.clearAllMocks()
  })

  describe("initialization", () => {
    it("should initialize the store with empty state", () => {
      const state = useIngredientsStore.getState()
      expect(state.ingredients).toEqual([])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe(null)
      expect(state.initialized).toBe(false)
    })

    it("should initialize ingredients on first call", async () => {
      const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
      mockGetIngredients.mockResolvedValue(Result.ok(mockIngredients))

      const { result } = renderHook(() => useIngredientsStore())

      expect(result.current.initialized).toBe(false)

      // First call should trigger initialization
      await act(async () => {
        await result.current.initialize()
      })

      await waitFor(() => {
        expect(result.current.ingredients).toEqual(mockIngredients)
        expect(result.current.initialized).toBe(true)
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockGetIngredients).toHaveBeenCalledTimes(1)
    })

    it("should not re-fetch if already initialized", async () => {
      const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
      mockGetIngredients.mockResolvedValue(Result.ok(mockIngredients))

      const { result } = renderHook(() => useIngredientsStore())

      // First initialization
      await act(async () => {
        await result.current.initialize()
      })

      // Reset mock to see if it gets called again
      mockGetIngredients.mockClear()

      // Second call should not fetch again
      await act(async () => {
        await result.current.initialize()
      })

      expect(mockGetIngredients).not.toHaveBeenCalled()
    })

    it("should handle initialization errors", async () => {
      const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
      const dbError = new DbQueryError("Network error", "getAll", "Ingredient")
      mockGetIngredients.mockResolvedValue(Result.fail(dbError))

      const { result } = renderHook(() => useIngredientsStore())

      await act(async () => {
        await result.current.initialize()
      })

      await waitFor(() => {
        expect(result.current.error).toBe("Network error")
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe("toggleIngredientCompletion", () => {
    beforeEach(async () => {
      const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
      mockGetIngredients.mockResolvedValue(Result.ok([...mockIngredients]))

      const { result } = renderHook(() => useIngredientsStore())
      await act(async () => {
        await result.current.initialize()
      })
    })

    it("should optimistically update completion and call service", async () => {
      const mockUpdateCompletion =
        ingredientService.updateCompletion as jest.Mock
      mockUpdateCompletion.mockResolvedValue(Result.ok(undefined))

      const { result } = renderHook(() => useIngredientsStore())

      const milkId = "1"

      await act(async () => {
        await result.current.toggleIngredientCompletion(milkId)
      })

      await waitFor(() => {
        const updatedMilk = result.current.ingredients.find(
          (ing) => ing.id === milkId
        )
        expect(updatedMilk?.completed).toBe(true)
      })

      expect(mockUpdateCompletion).toHaveBeenCalledWith(milkId, true)
    })

    it("should rollback on completion update failure", async () => {
      const mockUpdateCompletion =
        ingredientService.updateCompletion as jest.Mock
      const dbError = new DbQueryError(
        "Server error",
        "updateCompletion",
        "Ingredient"
      )
      mockUpdateCompletion.mockResolvedValue(Result.fail(dbError))

      const { result } = renderHook(() => useIngredientsStore())

      const breadId = "2" // Initially completed: true
      const originalCompleted = result.current.ingredients.find(
        (ing) => ing.id === breadId
      )?.completed

      await act(async () => {
        await result.current.toggleIngredientCompletion(breadId)
      })

      await waitFor(() => {
        const updatedBread = result.current.ingredients.find(
          (ing) => ing.id === breadId
        )
        expect(updatedBread?.completed).toBe(originalCompleted) // Should roll back
        expect(result.current.error).toBe("Server error")
      })
    })

    it("should handle non-existent ingredient", async () => {
      const { result } = renderHook(() => useIngredientsStore())

      await act(async () => {
        await result.current.toggleIngredientCompletion("non-existent")
      })

      expect(result.current.error).toBeDefined()
    })
  })

  describe("changeIngredientName", () => {
    beforeEach(async () => {
      const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
      mockGetIngredients.mockResolvedValue(Result.ok([...mockIngredients]))

      const { result } = renderHook(() => useIngredientsStore())
      await act(async () => {
        await result.current.initialize()
      })
    })

    it("should optimistically update name and call service", async () => {
      const mockUpdateName = ingredientService.updateName as jest.Mock
      mockUpdateName.mockResolvedValue(Result.ok(undefined))

      const { result } = renderHook(() => useIngredientsStore())

      const milkId = "1"
      const newName = "Almond Milk"

      await act(async () => {
        await result.current.changeIngredientName(milkId, newName)
      })

      await waitFor(() => {
        const updatedMilk = result.current.ingredients.find(
          (ing) => ing.id === milkId
        )
        expect(updatedMilk?.name).toBe(newName)
      })

      expect(mockUpdateName).toHaveBeenCalledWith(milkId, newName)
    })

    it("should rollback on name update failure", async () => {
      const mockUpdateName = ingredientService.updateName as jest.Mock
      const validationError = new ValidationError("Name too short", "name")
      mockUpdateName.mockResolvedValue(Result.fail(validationError))

      const { result } = renderHook(() => useIngredientsStore())

      const eggsId = "3"
      const originalName = result.current.ingredients.find(
        (ing) => ing.id === eggsId
      )?.name

      await act(async () => {
        await result.current.changeIngredientName(eggsId, "X")
      })

      await waitFor(() => {
        const updatedEggs = result.current.ingredients.find(
          (ing) => ing.id === eggsId
        )
        expect(updatedEggs?.name).toBe(originalName) // Should roll back
        expect(result.current.error).toBe("Name too short")
      })
    })

    it("should handle non-existent ingredient", async () => {
      const { result } = renderHook(() => useIngredientsStore())

      await act(async () => {
        await result.current.changeIngredientName("non-existent", "New Name")
      })

      expect(result.current.error).toBeDefined()
    })
  })

  describe("clearError", () => {
    it("should clear the error message", async () => {
      const { result } = renderHook(() => useIngredientsStore())

      // Set an error first
      act(() => {
        useIngredientsStore.setState({ error: "Some error" })
      })

      expect(result.current.error).toBe("Some error")

      act(() => {
        result.current.clearError()
      })

      expect(result.current.error).toBe(null)
    })
  })

  describe("state selectors", () => {
    beforeEach(async () => {
      const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
      mockGetIngredients.mockResolvedValue(Result.ok([...mockIngredients]))

      const { result } = renderHook(() => useIngredientsStore())
      await act(async () => {
        await result.current.initialize()
      })
    })

    it("should allow selecting ingredients", () => {
      const { result } = renderHook(() =>
        useIngredientsStore((state) => state.ingredients)
      )

      expect(result.current).toEqual(mockIngredients)
    })

    it("should allow selecting isLoading", () => {
      const { result } = renderHook(() =>
        useIngredientsStore((state) => state.isLoading)
      )

      expect(result.current).toBe(false)
    })

    it("should allow selecting error", () => {
      const { result } = renderHook(() =>
        useIngredientsStore((state) => state.error)
      )

      expect(result.current).toBe(null)
    })
  })

  describe("optimistic updates with concurrent operations", () => {
    beforeEach(async () => {
      const mockGetIngredients = ingredientService.GetIngredients as jest.Mock
      mockGetIngredients.mockResolvedValue(Result.ok([...mockIngredients]))

      const { result } = renderHook(() => useIngredientsStore())
      await act(async () => {
        await result.current.initialize()
      })
    })

    it("should handle multiple concurrent toggle operations", async () => {
      const mockUpdateCompletion =
        ingredientService.updateCompletion as jest.Mock
      mockUpdateCompletion.mockResolvedValue(Result.ok(undefined))

      const { result } = renderHook(() => useIngredientsStore())

      await act(async () => {
        await Promise.all([
          result.current.toggleIngredientCompletion("1"),
          result.current.toggleIngredientCompletion("2"),
          result.current.toggleIngredientCompletion("3"),
        ])
      })

      await waitFor(() => {
        expect(mockUpdateCompletion).toHaveBeenCalledTimes(3)
      })

      // All should be toggled
      expect(result.current.ingredients[0].completed).toBe(true)
      expect(result.current.ingredients[1].completed).toBe(false)
      expect(result.current.ingredients[2].completed).toBe(true)
    })
  })
})
