import React from "react"
import { useLocalSearchParams } from "expo-router"
import { Ingredient } from "@/types/Ingredient"
import { ingredientService } from "@/api/ingredient-service"
import { createLogger } from "@/api/common/logger"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { getDatabase } from "@/database/database"

const logger = createLogger("useIngredients")

/**
 * Hook to manage ingredient state and operations
 * Encapsulates business logic and API interactions
 * Maintains single source of truth for ingredient display
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
        setError(err.message)
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

  /**
   * Toggle ingredient completion status
   * Uses optimistic update - item stays in place, no auto-sorting
   */
  const toggleCompletion = React.useCallback(
    async (id: string) => {
      const ingredient = ingredients.find((ing) => ing.id === id)
      if (!ingredient) return

      const newCompletedState = !ingredient.completed

      // Optimistic update - immediate UI feedback
      setIngredients((prev) =>
        prev.map((ing) =>
          ing.id === id ? { ...ing, completed: newCompletedState } : ing
        )
      )

      try {
        await ingredientService.updateCompletion(id, newCompletedState)
      } catch (err) {
        logger.error("Error toggling completion", err)
        // Revert on error
        setIngredients((prev) =>
          prev.map((ing) =>
            ing.id === id ? { ...ing, completed: ingredient.completed } : ing
          )
        )
      }
    },
    [ingredients]
  )

  /**
   * Update ingredient name
   * Uses optimistic update
   */
  const updateName = React.useCallback(
    async (id: string, newName: string) => {
      const ingredient = ingredients.find((ing) => ing.id === id)
      if (!ingredient) return

      // Optimistic update
      setIngredients((prev) =>
        prev.map((ing) => (ing.id === id ? { ...ing, name: newName } : ing))
      )

      try {
        const result = await ingredientService.updateName(id, newName)
        if (!result.success) {
          // Revert on error
          setIngredients((prev) =>
            prev.map((ing) =>
              ing.id === id ? { ...ing, name: ingredient.name } : ing
            )
          )
        }
      } catch (err) {
        logger.error("Error updating name", err)
        // Revert on error
        setIngredients((prev) =>
          prev.map((ing) =>
            ing.id === id ? { ...ing, name: ingredient.name } : ing
          )
        )
      }
    },
    [ingredients]
  )

  /**
   * Delete ingredient
   */
  const deleteIngredient = React.useCallback(
    async (id: string) => {
      try {
        const result = await ingredientService.deleteIngredient(id)
        if (result.success) {
          // Refetch to update the list
          await loadIngredients()
        }
      } catch (err) {
        logger.error("Error deleting ingredient", err)
      }
    },
    [loadIngredients]
  )

  /**
   * Apply sorting to ingredients
   * Sorts by completion (incomplete first) then by creation date (newest first)
   * This is the "manual sort" that applies database ordering
   */
  const sortIngredients = React.useCallback(() => {
    setIngredients((prev) => {
      const sorted = [...prev].sort((a, b) => {
        // First by completion (incomplete first)
        if (a.completed !== b.completed) {
          return a.completed ? 1 : -1
        }
        // Then by creation date (newest first)
        return (b.created_at || 0) - (a.created_at || 0)
      })
      return sorted
    })
  }, [])

  return {
    ingredients,
    isLoading,
    error,
    refetch: loadIngredients,
    listName,
    listId,
    // Business operations
    toggleCompletion,
    updateName,
    deleteIngredient,
    sortIngredients,
  }
}
