import { create } from "zustand"
import { Ingredient } from "@/types/Ingredient"
import { ingredientService } from "@/api/ingredient-service"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("IngredientsStore")

/**
 * State interface for the ingredients store
 */
export interface IngredientsStoreState {
  // State
  ingredients: Ingredient[]
  isLoading: boolean
  error: string | null
  initialized: boolean

  // Actions
  initialize: () => Promise<void>
  toggleIngredientCompletion: (id: string) => Promise<void>
  changeIngredientName: (id: string, newName: string) => Promise<void>
  clearError: () => void
}

/**
 * Zustand store for managing ingredients globally
 *
 * This store is the single source of truth for all ingredient state.
 * It handles:
 * - Fetching ingredients from the service
 * - Optimistic updates with rollback on failure
 * - Error management
 * - Lazy initialization (first use)
 *
 * Usage:
 * ```typescript
 * // In a hook
 * const ingredients = useIngredientsStore(state => state.ingredients)
 * const toggleCompletion = useIngredientsStore(state => state.toggleIngredientCompletion)
 * ```
 */
export const useIngredientsStore = create<IngredientsStoreState>(
  (set, get) => ({
    // Initial state
    ingredients: [],
    isLoading: false,
    error: null,
    initialized: false,

    /**
     * Initialize the store by fetching ingredients from the service
     * Only fetches once, subsequent calls are no-ops
     */
    initialize: async () => {
      const state = get()
      if (state.initialized) {
        logger.debug("Store already initialized, skipping fetch")
        return
      }

      set({ isLoading: true, error: null })

      try {
        const result = await ingredientService.GetIngredients()

        if (result.success) {
          const ingredients = result.getValue() || []
          set({
            ingredients,
            isLoading: false,
            error: null,
            initialized: true,
          })
          logger.info(
            `Successfully initialized store with ${ingredients.length} ingredients`
          )
        } else {
          const error = result.getError()
          const errorMessage = error?.message || "Failed to load ingredients"
          set({
            isLoading: false,
            error: errorMessage,
            initialized: true,
          })
          logger.error("Failed to initialize store", error)
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error occurred"
        set({
          isLoading: false,
          error: `Failed to load ingredients: ${errorMessage}`,
          initialized: true,
        })
        logger.error("Error during store initialization", err)
      }
    },

    /**
     * Toggle ingredient completion status
     * Uses optimistic update with rollback on failure
     */
    toggleIngredientCompletion: async (id: string) => {
      const state = get()
      const ingredient = state.ingredients.find((ing) => ing.id === id)

      if (!ingredient) {
        set({ error: "Ingredient not found" })
        logger.error(`Ingredient with id ${id} not found`)
        return
      }

      // Optimistic update
      const originalIngredients = [...state.ingredients]
      const updatedIngredients = state.ingredients.map((ing) =>
        ing.id === id ? { ...ing, completed: !ing.completed } : ing
      )

      set({
        ingredients: updatedIngredients,
        error: null,
      })

      // Perform the actual update
      try {
        const result = await ingredientService.updateCompletion(
          id,
          !ingredient.completed
        )

        if (!result.success) {
          const error = result.getError()
          const errorMessage = error?.message || "Failed to update completion"
          set({
            ingredients: originalIngredients,
            error: errorMessage,
          })
          logger.error(
            `Failed to toggle completion for ingredient ${id}`,
            error
          )
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error occurred"
        set({
          ingredients: originalIngredients,
          error: `Failed to update completion: ${errorMessage}`,
        })
        logger.error(`Error toggling completion for ingredient ${id}`, err)
      }
    },

    /**
     * Change ingredient name
     * Uses optimistic update with rollback on failure
     */
    changeIngredientName: async (id: string, newName: string) => {
      const state = get()
      const ingredient = state.ingredients.find((ing) => ing.id === id)

      if (!ingredient) {
        set({ error: "Ingredient not found" })
        logger.error(`Ingredient with id ${id} not found`)
        return
      }

      // Optimistic update
      const originalIngredients = [...state.ingredients]
      const updatedIngredients = state.ingredients.map((ing) =>
        ing.id === id ? { ...ing, name: newName } : ing
      )

      set({
        ingredients: updatedIngredients,
        error: null,
      })

      // Perform the actual update
      try {
        const result = await ingredientService.updateName(id, newName)

        if (!result.success) {
          const error = result.getError()
          const errorMessage = error?.message || "Failed to change name"
          set({
            ingredients: originalIngredients,
            error: errorMessage,
          })
          logger.error(`Failed to change name for ingredient ${id}`, error)
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error occurred"
        set({
          ingredients: originalIngredients,
          error: `Failed to change name: ${errorMessage}`,
        })
        logger.error(`Error changing name for ingredient ${id}`, err)
      }
    },

    /**
     * Clear the error message
     */
    clearError: () => {
      set({ error: null })
    },
  })
)
