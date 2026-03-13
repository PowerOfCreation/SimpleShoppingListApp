import { useState, useCallback, useMemo } from "react"
import { IngredientList } from "@/types/IngredientList"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("useShoppingLists")

export function useShoppingLists() {
  const [lists, setLists] = useState<IngredientList[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const repository = useMemo(
    () => new IngredientListRepository(getDatabase()),
    []
  )

  const refetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await repository.getAll()
      if (result.success) {
        setLists(result.getValue()!)
      } else {
        const dbError = result.getError()
        logger.error("Error fetching shopping lists", dbError)
        setError(dbError?.message || "Failed to fetch shopping lists")
      }
    } catch (err) {
      logger.error("Unexpected error fetching shopping lists", err)
      setError("Failed to fetch shopping lists")
    } finally {
      setIsLoading(false)
    }
  }, [repository])

  return { lists, isLoading, error, refetch }
}
