import { ActionButton } from "@/components/ActionButton"
import { Entry } from "@/components/Entry"
import React from "react"
import { View } from "react-native"
import { router } from "expo-router"

import { ingredientService } from "../api/ingredient-service"
import Ingredient from "../types/Ingredient"

export default function Index() {
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([])

  React.useEffect(() => {
    ingredientService.GetIngredients().then((x) => setIngredients(x))
  }, [])

  const toggleIngredientCompletion = (index: number) => {
    const updatedIngredients = ingredients.map((element, i) => {
      if (i === index) {
        return { ...element, completed: !element.completed }
      }
      return element
    })

    ingredientService.Update(updatedIngredients)

    setIngredients(updatedIngredients)
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
      }}
    >
      {ingredients.map((prop, key) => {
        return (
          <Entry
            ingredientName={prop.name}
            isCompleted={prop.completed}
            onToggleComplete={() => toggleIngredientCompletion(key)}
            key={key}
          />
        )
      })}

      <ActionButton symbol="+" onPress={() => router.push("/new_ingredient")} />
    </View>
  )
}
