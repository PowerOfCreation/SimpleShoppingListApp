import { act, renderHook, waitFor } from "@testing-library/react-native"
import { useIngredients } from "../useIngredients"
import { getDatabase } from "@/database/database"
import { initializeAndMigrateDatabase } from "@/database/data-migration"
import { IngredientRepository } from "@/database/ingredient-repository"
import { getIngredientService } from "@/api/ingredient-service"
import { SortMode } from "@/types/SortMode"

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ listId: "sort-perf-list" }),
}))

describe("useIngredients - sort mode switching", () => {
  let db: ReturnType<typeof getDatabase>

  beforeAll(async () => {
    db = getDatabase()
    await initializeAndMigrateDatabase(db)
  })

  beforeEach(async () => {
    await db.execAsync(`DELETE FROM ingredients;`)
    await db.execAsync(`DELETE FROM ingredient_lists;`)
    const now = Date.now()
    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      "sort-perf-list",
      "Perf List",
      now,
      now
    )
    const repo = new IngredientRepository(db)
    await repo.add({
      id: "1",
      name: "Milk",
      completed: false,
      list_id: "sort-perf-list",
      created_at: now,
      updated_at: now,
    })
    await repo.add({
      id: "2",
      name: "Bread",
      completed: false,
      list_id: "sort-perf-list",
      created_at: now + 1,
      updated_at: now + 1,
    })
  })

  it("does not re-read SQLite when pressing sort switches modes", async () => {
    // Regression guard: loadIngredients used to depend on sortMode, so
    // switching modes re-created the callback and re-triggered the mount
    // effect, re-querying all rows for a change that's a pure in-memory
    // resort - the most wasteful part of a "sort a 1000+ item list" tap.
    const getIngredientsSpy = jest.spyOn(
      getIngredientService(),
      "GetIngredients"
    )

    const { result } = renderHook(() => useIngredients())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const callsAfterInitialLoad = getIngredientsSpy.mock.calls.length

    // The seeded list is already sorted by DATE, so pressing sort advances
    // the mode instead of just re-sorting.
    act(() => result.current.sortIngredients())
    await waitFor(() => expect(result.current.sortMode).toBe(SortMode.PRIORITY))

    expect(getIngredientsSpy.mock.calls.length).toBe(callsAfterInitialLoad)

    getIngredientsSpy.mockRestore()
  })
})
