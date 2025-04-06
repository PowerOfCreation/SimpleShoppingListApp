import { Ingredient } from "@/types/Ingredient"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"
import { IngredientRepository } from "@/database/ingredient-repository"
import { getDatabase } from "@/database/database"

export class IngredientService {
  ingredients: Ingredient[] = []
  initialLoad = true
  private repository: IngredientRepository

  constructor(repository?: IngredientRepository) {
    this.repository = repository || new IngredientRepository(getDatabase())
  }

  async GetIngredients() {
    try {
      if (this.initialLoad) {
        this.initialLoad = false
        this.ingredients = await this.repository.getAll()
      }

      return this.ingredients
    } catch (error) {
      console.error("Error fetching ingredients:", error)
      return []
    }
  }

  async AddIngredients(ingredientName: string): Promise<{
    isSuccessful: boolean
    error: string
  }> {
    if (!ingredientName.trim()) {
      return { isSuccessful: false, error: "Ingredient name can't be empty" }
    }

    try {
      const now = Date.now()
      const newIngredient: Ingredient = {
        name: ingredientName,
        completed: false,
        id: uuidv4(),
        created_at: now,
        updated_at: now,
      }

      // Add to repository
      await this.repository.add(newIngredient)

      // Add to local cache
      this.ingredients.unshift(newIngredient)

      return { isSuccessful: true, error: "" }
    } catch (error) {
      console.error("Error adding ingredient:", error)
      return { isSuccessful: false, error: "Failed to add ingredient" }
    }
  }

  async updateCompletion(id: string, completed: boolean): Promise<void> {
    try {
      await this.repository.updateCompletion(id, completed)
      // Update local cache
      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients[index].completed = completed
        this.ingredients[index].updated_at = Date.now()
      }
    } catch (error) {
      console.error(`Error updating completion for ingredient ${id}:`, error)
      throw error // Re-throw the error to be caught by the hook
    }
  }

  async updateName(id: string, name: string): Promise<void> {
    try {
      await this.repository.updateName(id, name)
      // Update local cache
      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients[index].name = name
        this.ingredients[index].updated_at = Date.now()
      }
    } catch (error) {
      console.error(`Error updating name for ingredient ${id}:`, error)
      throw error // Re-throw the error to be caught by the hook
    }
  }
}

export const ingredientService = new IngredientService()
