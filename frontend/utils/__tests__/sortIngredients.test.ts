import {
  formatSortMode,
  isSortedByMode,
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

describe("formatSortMode", () => {
  it("formats DATE", () => {
    expect(formatSortMode(SortMode.DATE)).toBe("Sorted by date added")
  })

  it("formats PRIORITY", () => {
    expect(formatSortMode(SortMode.PRIORITY)).toBe("Sorted by priority")
  })
})
