import { router } from "expo-router"
import React from "react"
import { Pressable, View, StyleSheet } from "react-native"
import { SafeAreaView } from "react-native"
import { ThemedText } from "@/components/ThemedText"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { ingredientService } from "../api/ingredient-service"

export default function NewIngredient() {
  const [text, onChangeText] = React.useState("")
  const [invalidInputExplanation, setInvalidInputExplanation] =
    React.useState("")

  const addIngredient = async (ingredientName: string) => {
    const result = await ingredientService.AddIngredients(ingredientName)

    if (!result.success) {
      const error = result.getError()
      setInvalidInputExplanation(error?.message || "Failed to add ingredient")
      return
    }

    router.navigate("/")
  }

  if (invalidInputExplanation && text.trim()) {
    setInvalidInputExplanation("")
  }

  return (
    <SafeAreaView style={styles.containerStyle}>
      <View style={styles.searchBarContainer}>
        <ThemedTextInput
          onSubmit={() => addIngredient(text)}
          onChangeText={onChangeText}
          value={text}
          placeholder="Ingredient name"
          borderColor={invalidInputExplanation ? "red" : undefined}
          autoFocus={true}
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
