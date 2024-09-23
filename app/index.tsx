import { ActionButton } from "@/components/ActionButton"
import { Entry } from "@/components/Entry"
import React from "react"
import { FlatList, SafeAreaView, StyleSheet } from "react-native"
import { router, useNavigation } from "expo-router"

import { ingredientService } from "../api/ingredient-service"
import { Ingredient } from "@/types/Ingredient"
import { ThemedText } from "@/components/ThemedText"

function SaveButton() {
  return <ThemedText>Save</ThemedText>
}

export default function Index() {
  const navigation = useNavigation()

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
      />
    )
  }

  React.useEffect(() => {
    if (ingredientToEdit) {
      navigation.setOptions({
        headerRight: () => SaveButton(),
      })
    } else {
      navigation.setOptions({
        headerRight: () => null,
      })
    }
  }, [navigation, ingredientToEdit])

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={ingredients}
        renderItem={renderEntry}
        keyExtractor={(item) => item.id}
        extraData={ingredientToEdit}
      />

      <ActionButton symbol="+" onPress={() => router.push("/new_ingredient")} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})
