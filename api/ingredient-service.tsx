import { Ingredient } from "@/types/Ingredient"
import { getItem, setItem } from "./common/async-storage"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"

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
    this.ingredients.push({
      name: ingredientName,
      completed: false,
      id: uuidv4(),
    })

    setItem("ingredients", this.ingredients)

    return this.ingredients
  }

  Update(ingredients: Ingredient[]) {
    this.ingredients = ingredients

    setItem("ingredients", this.ingredients)
  }
}

export const ingredientService = new IngredientService()
