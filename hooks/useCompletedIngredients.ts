import React from "react"
import { Ingredient } from "@/types/Ingredient"
import { ingredientService } from "@/api/ingredient-service"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("useCompletedIngredients")

/**
 * Hook to load completed ingredients for a shopping list
 * Returns ingredients ordered by completion date (most recent first)
 */
export function useCompletedIngredients(listId: string | undefined) {
  const [completedIngredients, setCompletedIngredients] = React.useState<
    Ingredient[]
  >([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadCompletedIngredients = React.useCallback(async () => {
    if (!listId) {
      setCompletedIngredients([])
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const result = await ingredientService.getCompletedIngredients(listId)

      if (!result.success) {
        const err = result.getError()
        setError(err.message)
        logger.error("Failed to load completed ingredients", err)
        return
      }

      setCompletedIngredients(result.getValue() || [])
    } catch (err) {
      setError("Failed to load completed ingredients")
      logger.error("Error loading completed ingredients", err)
    } finally {
      setIsLoading(false)
    }
  }, [listId])

  // Load completed ingredients on mount or when listId changes
  React.useEffect(() => {
    loadCompletedIngredients()
  }, [loadCompletedIngredients])

  return {
    completedIngredients,
    isLoading,
    error,
    refetch: loadCompletedIngredients,
  }
}
