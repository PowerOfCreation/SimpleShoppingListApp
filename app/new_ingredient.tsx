import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import React from "react"
import { Pressable, View, StyleSheet, TextInput } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ThemedText } from "@/components/ThemedText"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { ingredientService } from "../api/ingredient-service"

export default function NewIngredient() {
  const { listId } = useLocalSearchParams<{ listId: string }>()
  const [text, onChangeText] = React.useState("")
  const [invalidInputExplanation, setInvalidInputExplanation] =
    React.useState("")
  const inputRef = React.useRef<TextInput>(null)

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
      setInvalidInputExplanation(error?.message || "Failed to add ingredient")
      return
    }

    onChangeText("")
    router.back()
  }

  if (invalidInputExplanation && text.trim()) {
    setInvalidInputExplanation("")
  }

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
})
