import { ActionButton } from "@/components/ActionButton"
import { Entry } from "@/components/Entry"
import React from "react"
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  ActivityIndicator,
  View,
} from "react-native"
import { router } from "expo-router"

import { Ingredient } from "@/types/Ingredient"
import { ThemedText } from "@/components/ThemedText"
import { useIngredients } from "@/hooks/useIngredients"

export default function Index() {
  const {
    ingredients,
    isLoading,
    error,
    toggleIngredientCompletion,
    changeIngredientName,
  } = useIngredients()

  const [ingredientToEdit, setIngredientToEdit] = React.useState<string>("")

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

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      )
    }

    if (error) {
      return (
        <View style={styles.centered}>
          <ThemedText style={styles.errorTextStyle}>{error}</ThemedText>
        </View>
      )
    }

    if (ingredients.length === 0) {
      return (
        <ThemedText style={styles.emptyListInfoTextStyle} type="default">
          Press the '+' button at the bottom right to add your first product.
        </ThemedText>
      )
    }

    return (
      <FlatList
        data={ingredients}
        renderItem={renderEntry}
        keyExtractor={(item) => item.id}
        extraData={`${ingredientToEdit}-${error}`}
        removeClippedSubviews={false}
      />
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {renderContent()}
      <ActionButton symbol="+" onPress={() => router.push("/new_ingredient")} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyListInfoTextStyle: {
    padding: 20,
    textAlign: "center",
  },
  errorTextStyle: {
    color: "red",
    textAlign: "center",
  },
})
