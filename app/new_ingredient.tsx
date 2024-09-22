import { router } from "expo-router"
import React from "react"
import { Pressable, View } from "react-native"
import { SafeAreaView } from "react-native"
import { ThemedText } from "@/components/ThemedText"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { ingredientService } from "../api/ingredient-service"

export default function NewIngredient() {
  const [text, onChangeText] = React.useState("")

  const addIngredient = (ingredientName: string) => {
    ingredientService.AddIngredients(ingredientName)
    router.navigate("/")
  }

  return (
    <SafeAreaView
      style={{
        flex: 1,
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <ThemedTextInput
          onSubmit={() => addIngredient(text)}
          onChangeText={onChangeText}
          value={text}
          placeholder="Ingredient name"
        />

        <Pressable
          style={{ margin: 5, marginRight: 15 }}
          onPress={() => addIngredient(text)}
        >
          <ThemedText>Add</ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
