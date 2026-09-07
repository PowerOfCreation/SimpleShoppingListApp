import { Result } from "@/api/common/result"

export const RELEASES_URL =
  "https://github.com/PowerOfCreation/SimpleShoppingListApp/releases"
const API_URL =
  "https://api.github.com/repos/PowerOfCreation/SimpleShoppingListApp/releases"

export interface FrontendRelease {
  id: number
  tag_name: string
  name: string | null
  body: string | null
  published_at: string
  prerelease: boolean
  draft: boolean
}

export function isRelease(value: unknown): value is FrontendRelease {
  if (!value || typeof value !== "object") return false
  const r = value as Record<string, unknown>
  return (
    typeof r.id === "number" &&
    typeof r.tag_name === "string" &&
    (typeof r.name === "string" || r.name === null) &&
    (typeof r.body === "string" || r.body === null) &&
    typeof r.published_at === "string" &&
    Number.isFinite(Date.parse(r.published_at)) &&
    typeof r.prerelease === "boolean" &&
    typeof r.draft === "boolean"
  )
}

export async function fetchFrontendReleases(
  signal: AbortSignal
): Promise<Result<FrontendRelease[]>> {
  return Result.fromPromise(
    (async () => {
      const releases = new Map<number, FrontendRelease>()
      for (let page = 1; ; page++) {
        const response = await fetch(`${API_URL}?per_page=100&page=${page}`, {
          signal,
          headers: { Accept: "application/vnd.github+json" },
        })
        if (!response.ok)
          throw new Error(
            "Release notes could not be loaded from GitHub. Please try again later."
          )
        const data: unknown = await response.json()
        if (!Array.isArray(data)) throw new Error("Unexpected GitHub response.")
        for (const release of data) {
          if (
            isRelease(release) &&
            !release.draft &&
            release.tag_name.startsWith("frontend-v")
          ) {
            releases.set(release.id, release)
          }
        }
        if (data.length < 100) break
      }
      return [...releases.values()].sort(
        (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)
      )
    })()
  )
}
