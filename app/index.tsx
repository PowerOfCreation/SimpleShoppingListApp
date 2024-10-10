import { ActionButton } from "@/components/ActionButton"
import { Entry } from "@/components/Entry"
import React from "react"
import { FlatList, SafeAreaView, StyleSheet } from "react-native"
import { router } from "expo-router"

import { ingredientService } from "../api/ingredient-service"
import { Ingredient } from "@/types/Ingredient"
import { ThemedText } from "@/components/ThemedText"

export default function Index() {
  const [ingredients, setIngredients] = React.useState<Ingredient[]>([])
  const [ingredientToEdit, setIngredientToEdit] = React.useState<string>("")

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

  const changeIngredientName = (id: string, newName: string) => {
    const updatedIngredients = ingredients.map((element, _) => {
      if (element.id === id) {
        return { ...element, name: newName }
      }
      return element
    })

    ingredientService.Update(updatedIngredients)

    setIngredients(updatedIngredients)
  }

  const entryLongPress = (id: string) => {
    setIngredientToEdit(id)
  }

  const renderEntry = ({ item }: { item: Ingredient }) => {
    return (
      <Entry
        ingredientName={item.name}
        isCompleted={item.completed}
        onToggleComplete={() => toggleIngredientCompletion(item.id)}
        onLongPress={() => entryLongPress(item.id)}
        isEdited={ingredientToEdit === item.id}
        onCancelEditing={() => setIngredientToEdit("")}
        onSaveEditing={(text) => changeIngredientName(item.id, text)}
      />
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {ingredients.length === 0 ? (
        <ThemedText style={styles.emptyListInfoTextStyle} type="default">
          Press the '+' button at the bottom right to add your first product.
        </ThemedText>
      ) : (
        <FlatList
          data={ingredients}
          renderItem={renderEntry}
          keyExtractor={(item) => item.id}
          extraData={ingredientToEdit}
removeClippedSubviews={false}
        />
      )}

      <ActionButton symbol="+" onPress={() => router.push("/new_ingredient")} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyListInfoTextStyle: {
    padding: 20,
    height: "100%",
  },
})
