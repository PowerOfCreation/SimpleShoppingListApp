import { IngredientList } from "./IngredientList"

/**
 * Shopping list overview with ingredient counts
 * Used for efficient list display without loading all ingredient data
 */
export type ShoppingListOverview = IngredientList & {
  totalCount: number
  completedCount: number
}
