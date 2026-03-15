import { ActionButton } from "@/components/ActionButton"
import { Entry } from "@/components/Entry"
import React from "react"
import { FlatList, StyleSheet, ActivityIndicator, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect, useNavigation } from "expo-router"

import { Ingredient } from "@/types/Ingredient"
import { ThemedText } from "@/components/ThemedText"
import { useIngredients } from "@/hooks/useIngredients"
import { ingredientService } from "@/api/ingredient-service"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("ViewShoppingList")

export default function ViewShoppingList() {
  const {
    ingredients,
    isLoading,
    error,
    refetch,
    updateIngredient,
    listName,
    listId,
  } = useIngredients()
  const [ingredientToEdit, setIngredientToEdit] = React.useState<string>("")
  const navigation = useNavigation()

  // Update header title when listName changes
  React.useEffect(() => {
    if (listName) {
      navigation.setOptions({
        headerTitle: listName,
      })
    }
  }, [listName, navigation])

  // Refetch ingredients when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      refetch()
    }, [refetch])
  )

  const handleToggleComplete = async (id: string) => {
    const ingredient = ingredients.find((ing) => ing.id === id)
    if (!ingredient) return

    // Optimistically update UI immediately
    const newCompletedState = !ingredient.completed
    updateIngredient(id, { completed: newCompletedState })

    try {
      await ingredientService.updateCompletion(id, newCompletedState)
      // Don't refetch here - let useFocusEffect handle it when screen regains focus
      // This allows animations to play and prevents immediate re-sorting
    } catch (err) {
      logger.error("Error toggling completion", err)
      // Revert optimistic update on error
      updateIngredient(id, { completed: ingredient.completed })
    }
  }

  const handleChangeName = async (id: string, newName: string) => {
    const ingredient = ingredients.find((ing) => ing.id === id)
    if (!ingredient) return

    // Optimistically update UI immediately
    updateIngredient(id, { name: newName })
    setIngredientToEdit("")

    try {
      const result = await ingredientService.updateName(id, newName)
      if (!result.success) {
        // Revert optimistic update on error
        updateIngredient(id, { name: ingredient.name })
      }
    } catch (err) {
      logger.error("Error changing name", err)
      // Revert optimistic update on error
      updateIngredient(id, { name: ingredient.name })
    }
  }

  const handleDeleteIngredient = async (id: string) => {
    setIngredientToEdit("")

    try {
      const result = await ingredientService.deleteIngredient(id)
      if (result.success) {
        // Refetch to update the list
        refetch()
      }
    } catch (err) {
      logger.error("Error deleting ingredient", err)
    }
  }

  const entryLongPress = (id: string) => {
    setIngredientToEdit(id)
  }

  const renderEntry = ({ item }: { item: Ingredient }) => {
    return (
      <Entry
        id={item.id}
        ingredientName={item.name}
        isCompleted={item.completed}
        onToggleComplete={() => handleToggleComplete(item.id)}
        onLongPress={() => entryLongPress(item.id)}
        isEdited={ingredientToEdit === item.id}
        onCancelEditing={() => setIngredientToEdit("")}
        onSaveEditing={async (text) => {
          await handleChangeName(item.id, text)
        }}
        onDelete={() => handleDeleteIngredient(item.id)}
      />
    )
  }

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" accessibilityHint="loading data" />
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
        keyboardShouldPersistTaps="handled"
      />
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {renderContent()}
      <ActionButton
        testID="add-button"
        symbol="+"
        onPress={() =>
          router.push({ pathname: "/new_ingredient", params: { listId } })
        }
      />
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
