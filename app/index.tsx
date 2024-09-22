import { ActionButton } from "@/components/ActionButton"
import { Entry } from "@/components/Entry"
import React from "react"
import { FlatList, SafeAreaView } from "react-native"
import { router } from "expo-router"

import { ingredientService } from "../api/ingredient-service"
import { Ingredient } from "@/types/Ingredient"

export default function Index() {
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([])

  React.useEffect(() => {
    ingredientService.GetIngredients().then((x) => setIngredients(x))
  }, [])

  const toggleIngredientCompletion = (id: string) => {
    const updatedIngredients = ingredients.map((element, _) => {
      if (element.id === id) {
        return { ...element, completed: !element.completed }
      }
      return element
    })

    ingredientService.Update(updatedIngredients)

    setIngredients(updatedIngredients)
  }

  const renderEntry = ({ item }: { item: Ingredient }) => {
    return (
      <Entry
        ingredientName={item.name}
        isCompleted={item.completed}
        onToggleComplete={() => toggleIngredientCompletion(item.id)}
      />
    )
  }

  return (
    <SafeAreaView
      style={{
        flex: 1,
      }}
    >
      <FlatList
        data={ingredients}
        renderItem={renderEntry}
        keyExtractor={(item) => item.id}
      />

      <ActionButton symbol="+" onPress={() => router.push("/new_ingredient")} />
    </SafeAreaView>
  )
}
