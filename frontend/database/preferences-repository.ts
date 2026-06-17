import { getDatabase } from "./database"

export async function getPreference(key: string): Promise<string | null> {
  const db = getDatabase()
  const result = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_preferences WHERE key = ?",
    key
  )
  return result?.value ?? null
}

export async function setPreference(key: string, value: string): Promise<void> {
  const db = getDatabase()
  await db.runAsync(
    "INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)",
    key,
    value
  )
}
