import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import React from "react"
import { Pressable, View, StyleSheet, TextInput, FlatList } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ThemedText } from "@/components/ThemedText"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { ingredientService } from "@/api/ingredient-service"
import { useCompletedIngredients } from "@/hooks/useCompletedIngredients"
import { Ingredient } from "@/types/Ingredient"

export default function NewIngredient() {
  const { listId } = useLocalSearchParams<{ listId: string }>()
  const [text, onChangeText] = React.useState("")
  const [invalidInputExplanation, setInvalidInputExplanation] =
    React.useState("")
  const inputRef = React.useRef<TextInput>(null)

  const { completedIngredients } = useCompletedIngredients(listId)

  // Filter completed ingredients based on user input
  const filteredCompletedIngredients = React.useMemo(() => {
    const searchText = text.trim().toLowerCase()
    if (!searchText) {
      return completedIngredients
    }
    return completedIngredients.filter((ingredient) =>
      ingredient.name.toLowerCase().includes(searchText)
    )
  }, [text, completedIngredients])

  useFocusEffect(
    React.useCallback(() => {
      const id = setTimeout(() => {
        inputRef.current?.focus()
      }, 100) // we don't know when page is fully loaded on android, so we just wait a bit before focusing
      return () => clearTimeout(id)
    }, [])
  )

  const addIngredient = async (ingredientName: string) => {
    if (!listId) {
      setInvalidInputExplanation("No list selected")
      return
    }
    const result = await ingredientService.AddIngredients(
      ingredientName,
      listId
    )

    if (!result.success) {
      const error = result.getError()
      setInvalidInputExplanation(error.message)
      return
    }

    onChangeText("")
    router.back()
  }

  if (invalidInputExplanation && text.trim()) {
    setInvalidInputExplanation("")
  }

  const renderCompletedIngredient = ({ item }: { item: Ingredient }) => (
    <Pressable
      style={styles.completedIngredientItem}
      onPress={() => {
        onChangeText(item.name)
        inputRef.current?.focus()
      }}
    >
      <ThemedText style={styles.completedIngredientName}>
        {item.name}
      </ThemedText>
    </Pressable>
  )

  return (
    <SafeAreaView style={styles.containerStyle}>
      <View style={styles.searchBarContainer}>
        <ThemedTextInput
          ref={inputRef}
          onSubmit={() => addIngredient(text)}
          onChangeText={onChangeText}
          value={text}
          placeholder="Ingredient name"
          borderColor={invalidInputExplanation ? "red" : undefined}
        />

        <Pressable
          style={styles.buttonStyle}
          onPress={() => addIngredient(text)}
        >
          <ThemedText>Add</ThemedText>
        </Pressable>
      </View>
      {invalidInputExplanation ? (
        <ThemedText style={styles.invalidInputExplanationStyle}>
          {invalidInputExplanation}
        </ThemedText>
      ) : null}

      {filteredCompletedIngredients.length > 0 && (
        <View style={styles.completedIngredientsContainer}>
          <ThemedText style={styles.completedIngredientsHeader}>
            Previously completed
          </ThemedText>
          <FlatList
            data={filteredCompletedIngredients}
            renderItem={renderCompletedIngredient}
            keyExtractor={(item) => item.id}
            style={styles.completedIngredientsList}
          />
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  searchBarContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  containerStyle: {
    flex: 1,
    alignItems: "center",
  },
  buttonStyle: {
    margin: 5,
    marginRight: 15,
  },
  invalidInputExplanationStyle: {
    color: "red",
  },
  completedIngredientsContainer: {
    flex: 1,
    width: "100%",
    marginTop: 20,
    paddingHorizontal: 15,
  },
  completedIngredientsHeader: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
    opacity: 0.6,
  },
  completedIngredientsList: {
    flex: 1,
  },
  completedIngredientItem: {
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  completedIngredientName: {
    fontSize: 16,
  },
})
