import { useState, useCallback } from "react"
import { DomainEventRow } from "@/types/DomainEvent"
import { EventRepository } from "@/database/event-repository"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("useEvents")

export function useEvents() {
  const [events, setEvents] = useState<DomainEventRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const repo = new EventRepository(getDatabase())
      const result = await repo.getAll()
      if (result.success) {
        setEvents(result.getValue()!)
      } else {
        const dbError = result.getError()
        logger.error("Error fetching events", dbError)
        setError(dbError.message)
      }
    } catch (err) {
      logger.error("Unexpected error fetching events", err)
      setError("Failed to fetch events")
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { events, isLoading, error, refetch }
}
