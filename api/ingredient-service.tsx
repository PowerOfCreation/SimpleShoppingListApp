import { getItem, setItem } from "./common/async-storage"
import Ingredient from "../types/Ingredient"

class IngredientService {
  ingredients: Ingredient[] = []
  initialLoad = true

  async GetIngredients() {
    if (this.initialLoad) {
      this.initialLoad = false

      const loadedIngredients = await getItem("ingredients")
      this.ingredients = loadedIngredients ?? []
    }

    return this.ingredients
  }

  AddIngredients(ingredientName: string) {
    this.ingredients.push(new Ingredient(ingredientName))

    setItem("ingredients", this.ingredients)

    return this.ingredients
  }

  Update(ingredients: Ingredient[]) {
    this.ingredients = ingredients

    setItem("ingredients", this.ingredients)
  }
}

export const ingredientService = new IngredientService()
