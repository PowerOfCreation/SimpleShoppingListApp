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

      const loadedIngredients: Ingredient[] =
        (await getItem("ingredients")) ?? []

      const sortedByCompleted = loadedIngredients.sort(
        (a, b) => Number(a.completed) - Number(b.completed)
      )

      this.ingredients = sortedByCompleted
    }

    return this.ingredients
  }

  AddIngredients(ingredientName: string): {
    isSuccessful: boolean
    error: string
  } {
    if (!ingredientName.trim()) {
      return { isSuccessful: false, error: "Ingredient name can't be empty" }
    }

    this.ingredients.push({
      name: ingredientName,
      completed: false,
      id: uuidv4(),
    })

    setItem("ingredients", this.ingredients)

    return { isSuccessful: true, error: "" }
  }

  Update(ingredients: Ingredient[]) {
    this.ingredients = ingredients

    setItem("ingredients", this.ingredients)
  }
}

export const ingredientService = new IngredientService()
