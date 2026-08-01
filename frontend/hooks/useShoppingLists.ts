import { useState, useCallback, useEffect } from "react"
import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import { shoppingListService } from "@/api/shopping-list-service"
import { createLogger } from "@/api/common/logger"
import { onListDataChanged } from "@/api/sync/sync-events"

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

  // A pull can create/rename/delete a list, or change its ingredient
  // counts, in the background - refetch the overview whenever any list's
  // data changed rather than tracking exactly what changed.
  useEffect(() => {
    return onListDataChanged(() => {
      refetch()
    })
  }, [refetch])

  return { lists, isLoading, error, refetch, updateList }
}
