import { act, fireEvent, screen, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"
import ViewShoppingList from "../view_shopping_list"
import { IngredientRepository } from "@/database/ingredient-repository"
import { getDatabase } from "@/database/database"
import { initializeAndMigrateDatabase } from "@/database/data-migration"
import { notifyListDataChanged } from "@/api/sync/sync-events"
import type { Ingredient } from "@/types/Ingredient"
import type { IngredientList } from "@/types/IngredientList"

/**
 * Integration tests for ViewShoppingList component
 * These tests use real database and services - no mocking.
 * The database is initialized once (just like _layout does), then test data is set up for each test.
 * This behaves exactly like the real app.
 */

/**
 * Waits for the app to finish loading by checking if loading indicator is gone
 */
async function waitForAppReady() {
  await waitFor(() => {
    expect(screen.queryByAccessibilityHint("loading data")).toBeNull()
  })
}

/**
 * Creates a test ingredient list in the database
 */
async function createTestList(
  db: ReturnType<typeof getDatabase>,
  listData: Partial<IngredientList> & { id: string; name: string }
): Promise<void> {
  const now = Date.now()
  await db.runAsync(
    `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    listData.id,
    listData.name,
    listData.created_at ?? now,
    listData.updated_at ?? now
  )
}

/**
 * Creates a test ingredient in the database
 */
async function createTestIngredient(
  db: ReturnType<typeof getDatabase>,
  ingredientData: Partial<Ingredient> & {
    id: string
    name: string
    list_id: string
  }
): Promise<void> {
  const repo = new IngredientRepository(db)
  const now = Date.now()
  await repo.add({
    completed: false,
    created_at: now,
    updated_at: now,
    ...ingredientData,
  })
}

/**
 * Renders the ViewShoppingList component with the given list ID
 */
function renderShoppingListView(listId: string) {
  return renderRouter(
    { view_shopping_list: ViewShoppingList },
    { initialUrl: `/view_shopping_list?listId=${listId}` }
  )
}

/**
 * Cleans up all test data from the database
 */
async function cleanupDatabase(db: ReturnType<typeof getDatabase>) {
  await db.execAsync(`DELETE FROM ingredients;`)
  await db.execAsync(`DELETE FROM ingredient_lists;`)
}

describe("<ViewShoppingList /> Component Tests", () => {
  let db: ReturnType<typeof getDatabase>

  beforeAll(async () => {
    // Initialize once like _layout does - do NOT call resetDatabase()
    db = getDatabase()
    await initializeAndMigrateDatabase(db)
  })

  beforeEach(async () => {
    await cleanupDatabase(db)
  })

  it("renders without crashing", async () => {
    renderShoppingListView("list-1")

    await waitForAppReady()

    expect(screen.getByTestId("add-button")).toBeTruthy()
  })

  it("shows empty state when no ingredients", async () => {
    await createTestList(db, {
      id: "empty-list",
      name: "Empty List",
    })

    renderShoppingListView("empty-list")

    await waitForAppReady()

    expect(
      await screen.findByText("Add your first item with “Add item”.")
    ).toBeTruthy()
  })

  it("renders ingredient entries for the current list (integration)", async () => {
    await createTestList(db, {
      id: "list-with-items",
      name: "Test List",
    })
    await createTestList(db, {
      id: "list-2",
      name: "Other List",
    })

    await createTestIngredient(db, {
      id: "1",
      name: "Milk",
      completed: false,
      list_id: "list-with-items",
    })
    await createTestIngredient(db, {
      id: "2",
      name: "Bread",
      completed: true,
      list_id: "list-with-items",
    })
    // Belongs to a different list - should NOT appear
    await createTestIngredient(db, {
      id: "3",
      name: "Eggs",
      completed: false,
      list_id: "list-2",
    })

    renderShoppingListView("list-with-items")
    await waitForAppReady()

    expect(await screen.findByText("Milk")).toBeTruthy()
    expect(await screen.findByText("Bread")).toBeTruthy()
    expect(screen.queryByText("Eggs")).toBeNull()
  })

  it("does not reorder or flash a loading spinner when a sync pull confirms a just-toggled item", async () => {
    // Reproduces the reported bug: on a synced list, the device's own push
    // echoes back via a pull shortly after, which used to trigger a full
    // reload-and-resort (see event-applier.ts's notifyListDataChanged).
    // notifyListDataChanged is called directly here to simulate exactly
    // that signal, without needing real sync infrastructure.
    await createTestList(db, {
      id: "sync-list",
      name: "Synced List",
    })
    const now = Date.now()
    await createTestIngredient(db, {
      id: "a",
      name: "Apple",
      completed: false,
      list_id: "sync-list",
      created_at: now,
    })
    await createTestIngredient(db, {
      id: "b",
      name: "Banana",
      completed: false,
      list_id: "sync-list",
      created_at: now + 1000,
    })
    await createTestIngredient(db, {
      id: "c",
      name: "Carrot",
      completed: false,
      list_id: "sync-list",
      created_at: now + 2000,
    })

    renderShoppingListView("sync-list")
    await waitForAppReady()

    const before = screen
      .getAllByTestId(/^entry-component-/)
      .map((e) => e.props.testID)

    // Toggle "a" - real optimistic-update path (item stays in place).
    fireEvent.press(screen.getByTestId("entry-component-a"))

    // Simulate the sync pull that confirms this device's own push.
    await act(async () => {
      notifyListDataChanged("sync-list")
    })

    // Give the resulting reload a chance to run and settle.
    await waitFor(() => {
      expect(screen.getByTestId("entry-component-a")).toBeTruthy()
    })

    const after = screen
      .getAllByTestId(/^entry-component-/)
      .map((e) => e.props.testID)

    expect(after).toEqual(before)
    expect(screen.queryByAccessibilityHint("loading data")).toBeNull()
  })
})
