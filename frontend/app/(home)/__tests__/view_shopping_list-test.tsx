import { act, fireEvent, screen, waitFor } from "@testing-library/react-native"
import { setListPermissionDenied } from "@/api/sync/list-sync-status"
import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { renderRouter } from "expo-router/testing-library"
import ViewShoppingList from "../view_shopping_list"
import { IngredientRepository } from "@/database/ingredient-repository"
import { getDatabase } from "@/database/database"
import { initializeAndMigrateDatabase } from "@/database/data-migration"
import { notifyListDataChanged } from "@/api/sync/sync-events"
import { getIngredientService } from "@/api/ingredient-service"
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
    await renderShoppingListView("list-1")

    await waitForAppReady()

    expect(screen.getByTestId("add-button")).toBeTruthy()
  })

  it("shows empty state when no ingredients", async () => {
    await createTestList(db, {
      id: "empty-list",
      name: "Empty List",
    })

    await renderShoppingListView("empty-list")

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

    await renderShoppingListView("list-with-items")
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

    await renderShoppingListView("sync-list")
    await waitForAppReady()

    const before = screen
      .getAllByTestId(/^entry-component-/)
      .map((e) => e.props.testID)

    // Toggle "a" - real optimistic-update path (item stays in place).
    await fireEvent.press(screen.getByTestId("entry-component-a"))

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

  it("places a newly-added item above the completed ones on refetch, without moving existing rows", async () => {
    // Regression test: a background reload used to append brand-new items
    // at the very end via mergeIngredientsPreservingOrder, landing them
    // below already-completed items until the user pressed "Sort".
    await createTestList(db, {
      id: "add-list",
      name: "Add List",
    })
    const now = Date.now()
    await createTestIngredient(db, {
      id: "a",
      name: "Apple",
      completed: false,
      list_id: "add-list",
      created_at: now,
    })
    await createTestIngredient(db, {
      id: "b",
      name: "Banana",
      completed: true,
      list_id: "add-list",
      created_at: now + 1000,
    })

    await renderShoppingListView("add-list")
    await waitForAppReady()

    // New item added while the screen is already open (e.g. from the "new
    // ingredient" screen), then a refetch picks it up - same as refocusing.
    await createTestIngredient(db, {
      id: "c",
      name: "Carrot",
      completed: false,
      list_id: "add-list",
      created_at: now + 2000,
    })
    await act(async () => {
      notifyListDataChanged("add-list")
    })

    await waitFor(() => {
      expect(screen.getByTestId("entry-component-c")).toBeTruthy()
    })

    const order = screen
      .getAllByTestId(/^entry-component-/)
      .map((e) => e.props.testID)

    expect(order).toEqual([
      "entry-component-c",
      "entry-component-a",
      "entry-component-b",
    ])
  })

  it("reactivates and shows a completed item buried deep in a 1000+ item list, without pressing Sort", async () => {
    // Reported bug: on a large list (2 open, 1374 done), re-adding an item
    // whose match sits far down in the completed block reactivates it
    // (same id, see AddIngredients) and the header count updated to 3 open,
    // but the row itself stayed invisible until pressing Sort. Reproduces
    // at the same scale to catch anything that only shows up there.
    await createTestList(db, { id: "big-list", name: "Big List" })
    const now = Date.now()

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        "open-1",
        "Milk",
        0,
        "big-list",
        now,
        now
      )
      await db.runAsync(
        `INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        "open-2",
        "Bread",
        0,
        "big-list",
        now + 1,
        now + 1
      )
      for (let i = 0; i < 1374; i++) {
        await db.runAsync(
          `INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          `done-${i}`,
          i === 700 ? "Buried Item" : `Done ${i}`,
          1,
          "big-list",
          now + 2 + i,
          now + 2 + i
        )
      }
    })

    await renderShoppingListView("big-list")
    await waitForAppReady()

    expect(screen.getByText("2 open")).toBeTruthy()

    // Same call the "new ingredient" screen makes - matches "Buried Item" by
    // name and reactivates it (same id) instead of creating a duplicate.
    const result = await getIngredientService().AddIngredients(
      "Buried Item",
      "big-list"
    )
    expect(result.success).toBe(true)
    // Sanity check: confirm this actually reactivated done-700 in place,
    // not a plain create with a fresh id.
    expect(result.getValue()?.id).toBe("done-700")

    await act(async () => {
      notifyListDataChanged("big-list")
    })

    await waitFor(() => expect(screen.getByText("3 open")).toBeTruthy())

    // Not just present somewhere off-screen - the first rendered row.
    expect(await screen.findByTestId("entry-component-done-700")).toBeTruthy()
    const order = screen
      .getAllByTestId(/^entry-component-/)
      .map((e) => e.props.testID)
    expect(order[0]).toBe("entry-component-done-700")
  })

  it("shows no category headers in the default (date) sort mode", async () => {
    // The sort button lives in navigation.setOptions({ headerRight }),
    // which the native stack header doesn't render in this test
    // environment, so it can't be pressed here to reach category mode.
    // Section-grouping logic itself is covered directly in
    // utils/__tests__/sortIngredients.test.ts (sectionIngredientsByMode).
    await createTestList(db, {
      id: "category-list",
      name: "Category List",
    })
    await createTestIngredient(db, {
      id: "1",
      name: "Milch",
      completed: false,
      list_id: "category-list",
    })
    await createTestIngredient(db, {
      id: "2",
      name: "Banane",
      completed: false,
      list_id: "category-list",
    })

    await renderShoppingListView("category-list")
    await waitForAppReady()

    expect(await screen.findByText("Milch")).toBeTruthy()
    expect(screen.queryByText("Dairy & Cheese")).toBeNull()
    expect(screen.queryByText("Fruit & Vegetables")).toBeNull()
  })
})

it("shows the permission explanation above the items of an offline list", async () => {
  const db = getDatabase()
  await initializeAndMigrateDatabase(db)
  await createTestList(db, { id: "denied-detail", name: "Local groceries" })
  // A permission_denied flag only ever gets set for a list sync has already
  // enabled - real 403s come from push/pull/reconcile, which only touch
  // sync-enabled lists (see ListSyncStateRepository.setPermissionDenied).
  await new ListSyncStateRepository(db).setEnabled("denied-detail", true)
  await setListPermissionDenied("denied-detail", true)
  await renderShoppingListView("denied-detail")
  await waitForAppReady()
  await fireEvent.press(
    screen.getByRole("button", { name: "No permission to sync" })
  )
  expect(
    screen.getByText(/You can keep using the list on this device/)
  ).toBeTruthy()
  await fireEvent.press(screen.getByText("Close"))
  expect(screen.getByTestId("add-button")).toBeTruthy()
})
