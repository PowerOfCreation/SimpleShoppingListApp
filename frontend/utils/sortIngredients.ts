import { Ingredient } from "@/types/Ingredient"
import { SortMode } from "@/types/SortMode"

function compareByDate(a: Ingredient, b: Ingredient): number {
  return (b.created_at || 0) - (a.created_at || 0)
}

function compareByPriority(a: Ingredient, b: Ingredient): number {
  const aPriority = a.priority ?? Number.POSITIVE_INFINITY
  const bPriority = b.priority ?? Number.POSITIVE_INFINITY
  if (aPriority !== bPriority) {
    return aPriority - bPriority
  }
  return compareByDate(a, b)
}

/**
 * Sorts ingredients: incomplete items first, then (in priority mode only)
 * by priority, then by creation date (newest first)
 */
export function sortIngredientsByMode(
  ingredients: Ingredient[],
  mode: SortMode
): Ingredient[] {
  return [...ingredients].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1
    }
    return mode === SortMode.PRIORITY
      ? compareByPriority(a, b)
      : compareByDate(a, b)
  })
}

/**
 * Whether the given order already matches the sort order for a mode.
 * Used to decide whether pressing the sort button should just sort
 * the (now out of order) list, or switch to the other sort mode.
 */
export function isSortedByMode(
  ingredients: Ingredient[],
  mode: SortMode
): boolean {
  const sorted = sortIngredientsByMode(ingredients, mode)
  return ingredients.every((item, index) => item.id === sorted[index].id)
}

export function formatSortMode(mode: SortMode): string {
  switch (mode) {
    case SortMode.PRIORITY:
      return "Sorted by priority"
    case SortMode.DATE:
      return "Sorted by date added"
  }
}
