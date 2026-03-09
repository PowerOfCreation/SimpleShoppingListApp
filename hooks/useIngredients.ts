import React from "react"
import { Ingredient } from "@/types/Ingredient"
import { ingredientService } from "@/api/ingredient-service"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("useIngredients")

/**
 * Simple hook to manage ingredient loading and refreshing
 * No global state, no external dependencies - just loads from service
 */
export function useIngredients() {
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadIngredients = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await ingredientService.GetIngredients()
      if (result.success) {
        setIngredients(result.getValue() || [])
      } else {
        const err = result.getError()
        setError(err?.message || "Failed to load ingredients")
        logger.error("Failed to load ingredients", err)
      }
    } catch (err) {
      setError("Failed to load ingredients")
      logger.error("Error loading ingredients", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load ingredients on mount
  React.useEffect(() => {
    loadIngredients()
  }, [loadIngredients])

  return {
    ingredients,
    isLoading,
    error,
    refetch: loadIngredients,
  }
}
