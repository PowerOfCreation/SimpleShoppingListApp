import { useState, useCallback } from "react"
import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import { shoppingListService } from "@/api/shopping-list-service"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("useShoppingLists")

export function useShoppingLists() {
  const [lists, setLists] = useState<ShoppingListOverview[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await shoppingListService.getAllWithCounts()
      if (result.success) {
        setLists(result.getValue()!)
      } else {
        const dbError = result.getError()
        logger.error("Error fetching shopping lists", dbError)
        setError(dbError.message)
      }
    } catch (err) {
      logger.error("Unexpected error fetching shopping lists", err)
      setError("Failed to fetch shopping lists")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updateList = useCallback(
    (listId: string, updates: Partial<ShoppingListOverview>) => {
      setLists((prevLists) =>
        prevLists.map((list) =>
          list.id === listId ? { ...list, ...updates } : list
        )
      )
    },
    []
  )

  return { lists, isLoading, error, refetch, updateList }
}
