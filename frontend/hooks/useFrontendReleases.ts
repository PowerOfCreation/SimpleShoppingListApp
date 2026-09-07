import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useState } from "react"
import {
  fetchFrontendReleases,
  FrontendRelease,
  isRelease,
} from "@/api/releases/releases"

const CACHE_KEY = "frontend-releases-v1"

export function useFrontendReleases() {
  const [releases, setReleases] = useState<FrontendRelease[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY)
        const parsed: unknown = cached ? JSON.parse(cached) : null
        if (active && Array.isArray(parsed) && parsed.every(isRelease))
          setReleases(parsed)
      } catch {
        // A missing or corrupt cache must not prevent fetching release notes.
      }
      if (!active) return
      const timeout = setTimeout(() => controller.abort(), 15000)
      const result = await fetchFrontendReleases(controller.signal)
      clearTimeout(timeout)
      if (!active) return
      if (result.success) {
        const fresh = result.getValue() ?? []
        setReleases(fresh)
        try {
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh))
        } catch {
          // Notes remain available for this session if storage is unavailable.
        }
      } else {
        setError(
          "Could not refresh release notes. Check your connection and try again. Previously loaded notes remain available."
        )
      }
      if (active) setLoading(false)
    }
    void load()
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  return {
    releases,
    loading,
    error,
    refresh: () => setAttempt((value) => value + 1),
  }
}
