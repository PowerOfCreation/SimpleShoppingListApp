import { Ingredient } from "@/types/Ingredient"
import { SortMode } from "@/types/SortMode"
import { categorizeIngredient } from "@/utils/categorize"
import { categoryOrder } from "@/constants/Categories"

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

function compareByCategory(a: Ingredient, b: Ingredient): number {
  const aOrder = categoryOrder(categorizeIngredient(a.name))
  const bOrder = categoryOrder(categorizeIngredient(b.name))
  if (aOrder !== bOrder) {
    return aOrder - bOrder
  }
  return compareByDate(a, b)
}

function compareByMode(
  mode: SortMode
): (a: Ingredient, b: Ingredient) => number {
  switch (mode) {
    case SortMode.PRIORITY:
      return compareByPriority
    case SortMode.CATEGORY:
      return compareByCategory
    case SortMode.DATE:
      return compareByDate
  }
}

/**
 * Sorts ingredients: incomplete items first, then by the active mode
 * (priority, category, or creation date), falling back to creation date
 * (newest first) as a tiebreak within priority and category modes.
 */
export function sortIngredientsByMode(
  ingredients: Ingredient[],
  mode: SortMode
): Ingredient[] {
  const compare = compareByMode(mode)
  return [...ingredients].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1
    }
    return compare(a, b)
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

/**
 * Merges freshly-fetched ingredients into the existing display order: known
 * items are patched in place (content updates, same position), brand-new
 * items are appended, removed items drop out. Used for any background
 * refresh (sync pull, screen refocus, post-delete) so that data changing
 * under the user never itself repositions a row - only pressing "Sort" does.
 */
export function mergeIngredientsPreservingOrder(
  existing: Ingredient[],
  fresh: Ingredient[]
): Ingredient[] {
  const freshById = new Map(fresh.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const merged: Ingredient[] = []

  for (const item of existing) {
    const updated = freshById.get(item.id)
    if (updated) {
      merged.push(updated)
      seen.add(item.id)
    }
  }
  for (const item of fresh) {
    if (!seen.has(item.id)) {
      merged.push(item)
    }
  }
  return merged
}

export function formatSortMode(mode: SortMode): string {
  switch (mode) {
    case SortMode.PRIORITY:
      return "Sorted by priority"
    case SortMode.CATEGORY:
      return "Sorted by category"
    case SortMode.DATE:
      return "Sorted by date added"
  }
}
