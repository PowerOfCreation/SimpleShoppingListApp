import React from "react"
import { useIngredientsStore } from "@/store/ingredientStore"

/**
 * Hook to access ingredients state and actions from the global Zustand store
 *
 * This hook replaces the previous useReducer implementation with a cleaner
 * interface to the global store. It handles:
 * - Lazy initialization of the store on first use
 * - Providing state selectors (ingredients, isLoading, error)
 * - Providing action callbacks (toggleIngredientCompletion, changeIngredientName)
 *
 * Key improvements over previous version:
 * - No useFocusEffect hack (data persists across navigation)
 * - No isInitialMount ref (single initialization on first use)
 * - Single source of truth via Zustand store
 * - Much simpler to test and reason about
 *
 * @returns Object with ingredients, isLoading, error, and action functions
 */
export function useIngredients() {
  // Get state from store
  const ingredients = useIngredientsStore((state) => state.ingredients)
  const isLoading = useIngredientsStore((state) => state.isLoading)
  const error = useIngredientsStore((state) => state.error)
  const initialized = useIngredientsStore((state) => state.initialized)

  // Get actions from store
  const initialize = useIngredientsStore((state) => state.initialize)
  const toggleIngredientCompletion = useIngredientsStore(
    (state) => state.toggleIngredientCompletion
  )
  const changeIngredientName = useIngredientsStore(
    (state) => state.changeIngredientName
  )

  // Initialize store on first use (lazy initialization)
  React.useEffect(() => {
    if (!initialized) {
      initialize()
    }
  }, [initialized, initialize])

  return {
    ingredients,
    isLoading,
    error,
    toggleIngredientCompletion,
    changeIngredientName,
  }
}
