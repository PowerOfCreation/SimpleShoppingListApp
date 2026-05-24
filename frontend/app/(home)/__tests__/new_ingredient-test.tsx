import { screen, fireEvent, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"
import NewIngredient from "../new_ingredient"
import { IngredientRepository } from "@/database/ingredient-repository"
import { getDatabase } from "@/database/database"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { initializeAndMigrateDatabase } from "@/database/data-migration"
import type { Ingredient } from "@/types/Ingredient"
import type { IngredientList } from "@/types/IngredientList"
import { router } from "expo-router"

// Mock router.back() to prevent navigation errors in tests
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  router: {
    back: jest.fn(),
  },
}))

/**
 * Integration tests for NewIngredient component
 * These tests use real database and services - no mocking.
 * Tests focus on the filtering behavior and ingredient addition.
 */

/**
 * Creates a test ingredient list in the database
 */
async function createTestList(
  db: ReturnType<typeof getDatabase>,
  listData: Partial<IngredientList> & { id: string; name: string }
): Promise<void> {
  const listRepo = new IngredientListRepository(db)
  const now = Date.now()
  await listRepo.add({
    created_at: now,
    updated_at: now,
    ...listData,
  })
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
 * Renders the NewIngredient component with the given list ID
 */
function renderNewIngredient(listId: string) {
  return renderRouter(
    { new_ingredient: NewIngredient },
    { initialUrl: `/new_ingredient?listId=${listId}` }
  )
}

/**
 * Cleans up all test data from the database
 */
async function cleanupDatabase(db: ReturnType<typeof getDatabase>) {
  await db.execAsync(`DELETE FROM ingredients;`)
  await db.execAsync(`DELETE FROM ingredient_lists;`)
}

describe("<NewIngredient /> Component Tests", () => {
  let db: ReturnType<typeof getDatabase>

  beforeAll(async () => {
    db = getDatabase()
    await initializeAndMigrateDatabase(db)
  })

  beforeEach(async () => {
    await cleanupDatabase(db)
    // Clear router.back mock before each test
    jest.mocked(router.back).mockClear()
  })

  it("renders without crashing", async () => {
    await createTestList(db, {
      id: "list-1",
      name: "Test List",
    })

    renderNewIngredient("list-1")

    expect(await screen.findByPlaceholderText("Ingredient name")).toBeTruthy()
    expect(screen.getByText("Add")).toBeTruthy()
  })

  it("shows previously completed ingredients", async () => {
    await createTestList(db, {
      id: "list-1",
      name: "Test List",
    })
    await createTestIngredient(db, {
      id: "1",
      name: "Milk",
      completed: true,
      list_id: "list-1",
    })
    await createTestIngredient(db, {
      id: "2",
      name: "Bread",
      completed: true,
      list_id: "list-1",
    })

    renderNewIngredient("list-1")

    expect(await screen.findByText("Previously completed")).toBeTruthy()
    expect(await screen.findByText("Milk")).toBeTruthy()
    expect(await screen.findByText("Bread")).toBeTruthy()
  })

  it("does not show incomplete ingredients in previously completed section", async () => {
    await createTestList(db, {
      id: "list-1",
      name: "Test List",
    })
    await createTestIngredient(db, {
      id: "1",
      name: "Milk",
      completed: true,
      list_id: "list-1",
    })
    await createTestIngredient(db, {
      id: "2",
      name: "Eggs",
      completed: false,
      list_id: "list-1",
    })

    renderNewIngredient("list-1")

    expect(await screen.findByText("Milk")).toBeTruthy()
    expect(screen.queryByText("Eggs")).toBeNull()
  })

  it("does not show completed ingredients from other lists", async () => {
    await createTestList(db, {
      id: "list-1",
      name: "Test List 1",
    })
    await createTestList(db, {
      id: "list-2",
      name: "Test List 2",
    })
    await createTestIngredient(db, {
      id: "1",
      name: "Milk",
      completed: true,
      list_id: "list-1",
    })
    await createTestIngredient(db, {
      id: "2",
      name: "Eggs",
      completed: true,
      list_id: "list-2",
    })

    renderNewIngredient("list-1")

    expect(await screen.findByText("Milk")).toBeTruthy()
    expect(screen.queryByText("Eggs")).toBeNull()
  })

  describe("Filter functionality", () => {
    it("shows all completed ingredients when search is empty", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })
      await createTestIngredient(db, {
        id: "1",
        name: "Milk",
        completed: true,
        list_id: "list-1",
      })
      await createTestIngredient(db, {
        id: "2",
        name: "Bread",
        completed: true,
        list_id: "list-1",
      })

      renderNewIngredient("list-1")

      expect(await screen.findByText("Milk")).toBeTruthy()
      expect(await screen.findByText("Bread")).toBeTruthy()
    })

    it("filters completed ingredients by partial name match", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })
      await createTestIngredient(db, {
        id: "1",
        name: "Whole Milk",
        completed: true,
        list_id: "list-1",
      })
      await createTestIngredient(db, {
        id: "2",
        name: "Almond Milk",
        completed: true,
        list_id: "list-1",
      })
      await createTestIngredient(db, {
        id: "3",
        name: "Bread",
        completed: true,
        list_id: "list-1",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")

      // Type "milk" to filter
      fireEvent.changeText(input, "milk")

      await waitFor(() => {
        expect(screen.getByText("Whole Milk")).toBeTruthy()
        expect(screen.getByText("Almond Milk")).toBeTruthy()
        expect(screen.queryByText("Bread")).toBeNull()
      })
    })

    it("filters are case-insensitive", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })
      await createTestIngredient(db, {
        id: "1",
        name: "Milk",
        completed: true,
        list_id: "list-1",
      })
      await createTestIngredient(db, {
        id: "2",
        name: "Bread",
        completed: true,
        list_id: "list-1",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")

      // Type uppercase version
      fireEvent.changeText(input, "MILK")

      await waitFor(() => {
        expect(screen.getByText("Milk")).toBeTruthy()
        expect(screen.queryByText("Bread")).toBeNull()
      })
    })

    it("shows no results when filter matches nothing", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })
      await createTestIngredient(db, {
        id: "1",
        name: "Milk",
        completed: true,
        list_id: "list-1",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")

      fireEvent.changeText(input, "xyz")

      await waitFor(() => {
        expect(screen.queryByText("Milk")).toBeNull()
        expect(screen.queryByText("Previously completed")).toBeNull()
      })
    })

    it("handles whitespace in search query", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })
      await createTestIngredient(db, {
        id: "1",
        name: "Milk",
        completed: true,
        list_id: "list-1",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")

      // Type with leading/trailing spaces
      fireEvent.changeText(input, "  milk  ")

      await waitFor(() => {
        expect(screen.getByText("Milk")).toBeTruthy()
      })
    })

    it("clears filter when input is cleared", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })
      await createTestIngredient(db, {
        id: "1",
        name: "Milk",
        completed: true,
        list_id: "list-1",
      })
      await createTestIngredient(db, {
        id: "2",
        name: "Bread",
        completed: true,
        list_id: "list-1",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")

      // Filter to show only Milk
      fireEvent.changeText(input, "milk")
      await waitFor(() => {
        expect(screen.queryByText("Bread")).toBeNull()
      })

      // Clear the filter
      fireEvent.changeText(input, "")

      await waitFor(() => {
        expect(screen.getByText("Milk")).toBeTruthy()
        expect(screen.getByText("Bread")).toBeTruthy()
      })
    })
  })

  describe("Adding ingredients", () => {
    it("adds ingredient with valid name", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")
      const addButton = screen.getByText("Add")

      fireEvent.changeText(input, "New Ingredient")
      fireEvent.press(addButton)

      // Verify ingredient was added to database
      await waitFor(async () => {
        const repo = new IngredientRepository(db)
        const result = await repo.getAll("list-1")
        expect(result.success).toBe(true)
        const ingredients = result.getValue()!
        expect(ingredients.length).toBe(1)
        expect(ingredients[0].name).toBe("New Ingredient")
      })

      // Verify router.back() was called
      expect(router.back).toHaveBeenCalled()
    })

    it("shows error when adding empty ingredient name", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })

      renderNewIngredient("list-1")

      const addButton = screen.getByText("Add")

      // Try to add with empty name
      fireEvent.press(addButton)

      await waitFor(() => {
        expect(screen.getByText("Ingredient name can't be empty")).toBeTruthy()
      })
    })

    it("shows error when adding whitespace-only ingredient name", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")
      const addButton = screen.getByText("Add")

      fireEvent.changeText(input, "   ")
      fireEvent.press(addButton)

      await waitFor(() => {
        expect(screen.getByText("Ingredient name can't be empty")).toBeTruthy()
      })
    })

    it("clears error message when user starts typing", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })

      renderNewIngredient("list-1")

      const input = await screen.findByPlaceholderText("Ingredient name")
      const addButton = screen.getByText("Add")

      // Trigger error
      fireEvent.press(addButton)
      await waitFor(() => {
        expect(screen.getByText("Ingredient name can't be empty")).toBeTruthy()
      })

      // Start typing
      fireEvent.changeText(input, "M")

      await waitFor(() => {
        expect(screen.queryByText("Ingredient name can't be empty")).toBeNull()
      })
    })
  })

  describe("User interactions", () => {
    it("populates input when clicking on a completed ingredient", async () => {
      await createTestList(db, {
        id: "list-1",
        name: "Test List",
      })
      await createTestIngredient(db, {
        id: "1",
        name: "Milk",
        completed: true,
        list_id: "list-1",
      })

      renderNewIngredient("list-1")

      const completedIngredient = await screen.findByText("Milk")
      const input = await screen.findByPlaceholderText("Ingredient name")

      fireEvent.press(completedIngredient)

      await waitFor(() => {
        expect(input.props.value).toBe("Milk")
      })
    })
  })
})
