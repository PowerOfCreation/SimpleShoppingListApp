import {
  formatSortMode,
  isSortedByMode,
  mergeIngredientsPreservingOrder,
  sortIngredientsByMode,
} from "@/utils/sortIngredients"
import { SortMode } from "@/types/SortMode"
import { Priority } from "@/types/Priority"
import { Ingredient } from "@/types/Ingredient"

function makeIngredient(overrides: Partial<Ingredient>): Ingredient {
  return {
    id: "id",
    name: "name",
    completed: false,
    list_id: "list-1",
    ...overrides,
  }
}

describe("sortIngredientsByMode", () => {
  it("always puts incomplete items before completed ones", () => {
    const items = [
      makeIngredient({ id: "1", completed: true, created_at: 1 }),
      makeIngredient({ id: "2", completed: false, created_at: 2 }),
    ]

    const sorted = sortIngredientsByMode(items, SortMode.DATE)

    expect(sorted.map((i) => i.id)).toEqual(["2", "1"])
  })

  it("date mode sorts by creation date, newest first", () => {
    const items = [
      makeIngredient({ id: "1", created_at: 1 }),
      makeIngredient({ id: "2", created_at: 3 }),
      makeIngredient({ id: "3", created_at: 2 }),
    ]

    const sorted = sortIngredientsByMode(items, SortMode.DATE)

    expect(sorted.map((i) => i.id)).toEqual(["2", "3", "1"])
  })

  it("priority mode sorts by priority before creation date", () => {
    const items = [
      makeIngredient({
        id: "1",
        priority: Priority.DAYS_4_PLUS,
        created_at: 3,
      }),
      makeIngredient({ id: "2", priority: Priority.NOW, created_at: 1 }),
      makeIngredient({
        id: "3",
        priority: Priority.DAYS_1_TO_3,
        created_at: 2,
      }),
    ]

    const sorted = sortIngredientsByMode(items, SortMode.PRIORITY)

    expect(sorted.map((i) => i.id)).toEqual(["2", "3", "1"])
  })

  it("priority mode puts items without a priority last within their group", () => {
    const items = [
      makeIngredient({ id: "1", created_at: 1 }),
      makeIngredient({
        id: "2",
        priority: Priority.DAYS_4_PLUS,
        created_at: 2,
      }),
    ]

    const sorted = sortIngredientsByMode(items, SortMode.PRIORITY)

    expect(sorted.map((i) => i.id)).toEqual(["2", "1"])
  })

  it("priority mode falls back to creation date within the same priority", () => {
    const items = [
      makeIngredient({ id: "1", priority: Priority.NOW, created_at: 1 }),
      makeIngredient({ id: "2", priority: Priority.NOW, created_at: 2 }),
    ]

    const sorted = sortIngredientsByMode(items, SortMode.PRIORITY)

    expect(sorted.map((i) => i.id)).toEqual(["2", "1"])
  })

  it("category mode groups items by their detected category", () => {
    const items = [
      makeIngredient({ id: "1", name: "Klopapier", created_at: 1 }), // Household
      makeIngredient({ id: "2", name: "Banane", created_at: 2 }), // Fruit & Vegetables
      makeIngredient({ id: "3", name: "Milch", created_at: 3 }), // Dairy & Cheese
    ]

    const sorted = sortIngredientsByMode(items, SortMode.CATEGORY)

    expect(sorted.map((i) => i.id)).toEqual(["2", "3", "1"])
  })

  it("category mode puts unrecognized names last, after known categories", () => {
    const items = [
      makeIngredient({ id: "1", name: "Xyzzyzzq", created_at: 1 }), // Other
      makeIngredient({ id: "2", name: "Banane", created_at: 2 }), // Fruit & Vegetables
    ]

    const sorted = sortIngredientsByMode(items, SortMode.CATEGORY)

    expect(sorted.map((i) => i.id)).toEqual(["2", "1"])
  })

  it("category mode falls back to creation date within the same category", () => {
    const items = [
      makeIngredient({ id: "1", name: "Banane", created_at: 1 }),
      makeIngredient({ id: "2", name: "Apfel", created_at: 2 }),
    ]

    const sorted = sortIngredientsByMode(items, SortMode.CATEGORY)

    expect(sorted.map((i) => i.id)).toEqual(["2", "1"])
  })
})

describe("isSortedByMode", () => {
  it("returns true when already in sorted order", () => {
    const items = [
      makeIngredient({ id: "1", priority: Priority.NOW, created_at: 2 }),
      makeIngredient({
        id: "2",
        priority: Priority.DAYS_4_PLUS,
        created_at: 1,
      }),
    ]

    expect(isSortedByMode(items, SortMode.PRIORITY)).toBe(true)
  })

  it("returns false when order does not match the mode", () => {
    const items = [
      makeIngredient({
        id: "1",
        priority: Priority.DAYS_4_PLUS,
        created_at: 1,
      }),
      makeIngredient({ id: "2", priority: Priority.NOW, created_at: 2 }),
    ]

    expect(isSortedByMode(items, SortMode.PRIORITY)).toBe(false)
  })

  it("returns false when a completed item is out of place", () => {
    const items = [
      makeIngredient({ id: "1", completed: true, created_at: 2 }),
      makeIngredient({ id: "2", completed: false, created_at: 1 }),
    ]

    expect(isSortedByMode(items, SortMode.DATE)).toBe(false)
  })
})

describe("mergeIngredientsPreservingOrder", () => {
  it("patches an existing item's fields without moving its position", () => {
    const existing = [
      makeIngredient({ id: "1", name: "Milk", completed: false }),
      makeIngredient({ id: "2", name: "Bread", completed: false }),
    ]
    const fresh = [
      makeIngredient({ id: "2", name: "Bread", completed: false }),
      makeIngredient({ id: "1", name: "Milk", completed: true }), // toggled
    ]

    const merged = mergeIngredientsPreservingOrder(existing, fresh)

    expect(merged.map((i) => i.id)).toEqual(["1", "2"])
    expect(merged[0].completed).toBe(true)
  })

  it("appends a brand-new item at the end", () => {
    const existing = [makeIngredient({ id: "1", name: "Milk" })]
    const fresh = [
      makeIngredient({ id: "1", name: "Milk" }),
      makeIngredient({ id: "2", name: "Bread" }),
    ]

    const merged = mergeIngredientsPreservingOrder(existing, fresh)

    expect(merged.map((i) => i.id)).toEqual(["1", "2"])
  })

  it("drops an item no longer present", () => {
    const existing = [
      makeIngredient({ id: "1", name: "Milk" }),
      makeIngredient({ id: "2", name: "Bread" }),
    ]
    const fresh = [makeIngredient({ id: "2", name: "Bread" })]

    const merged = mergeIngredientsPreservingOrder(existing, fresh)

    expect(merged.map((i) => i.id)).toEqual(["2"])
  })

  it("handles patch, append, and drop together", () => {
    const existing = [
      makeIngredient({ id: "1", name: "Milk", completed: false }),
      makeIngredient({ id: "2", name: "Bread", completed: false }), // will be dropped
      makeIngredient({ id: "3", name: "Eggs", completed: false }),
    ]
    const fresh = [
      makeIngredient({ id: "3", name: "Eggs", completed: true }), // patched
      makeIngredient({ id: "1", name: "Milk", completed: false }),
      makeIngredient({ id: "4", name: "Cheese", completed: false }), // new
    ]

    const merged = mergeIngredientsPreservingOrder(existing, fresh)

    expect(merged.map((i) => i.id)).toEqual(["1", "3", "4"])
    expect(merged.find((i) => i.id === "3")?.completed).toBe(true)
  })
})

describe("formatSortMode", () => {
  it("formats DATE", () => {
    expect(formatSortMode(SortMode.DATE)).toBe("Sorted by date added")
  })

  it("formats PRIORITY", () => {
    expect(formatSortMode(SortMode.PRIORITY)).toBe("Sorted by priority")
  })

  it("formats CATEGORY", () => {
    expect(formatSortMode(SortMode.CATEGORY)).toBe("Sorted by category")
  })
})
