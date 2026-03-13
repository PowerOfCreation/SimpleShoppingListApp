import React from "react"
import { useLocalSearchParams } from "expo-router"
import { Ingredient } from "@/types/Ingredient"
import { ingredientService } from "@/api/ingredient-service"
import { createLogger } from "@/api/common/logger"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { getDatabase } from "@/database/database"

const logger = createLogger("useIngredients")

/**
 * Simple hook to manage ingredient loading and refreshing
 * No global state, no external dependencies - just loads from service
 */
export function useIngredients() {
  const { listId } = useLocalSearchParams<{ listId: string }>()
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [listName, setListName] = React.useState<string | null>(null)

  const loadIngredients = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await ingredientService.GetIngredients(listId)

      if (!result.success) {
        const err = result.getError()
        setError(err?.message || "Failed to load ingredients")
        logger.error("Failed to load ingredients", err)
        return
      }

      setIngredients(result.getValue() || [])
    } catch (err) {
      setError("Failed to load ingredients")
      logger.error("Error loading ingredients", err)
    } finally {
      setIsLoading(false)
    }
  }, [listId])

  // Load list name when listId changes
  React.useEffect(() => {
    async function loadListName() {
      if (!listId) {
        setListName(null)
        return
      }
      try {
        const repository = new IngredientListRepository(getDatabase())
        const result = await repository.getById(listId)
        if (result.success) {
          const list = result.getValue()
          setListName(list?.name || null)
        }
      } catch (err) {
        logger.error("Error loading list name", err)
      }
    }
    loadListName()
  }, [listId])

  // Load ingredients on mount
  React.useEffect(() => {
    loadIngredients()
  }, [loadIngredients])

  return {
    ingredients,
    isLoading,
    error,
    refetch: loadIngredients,
    listName,
    listId,
  }
}
