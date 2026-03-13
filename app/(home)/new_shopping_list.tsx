import { router, useFocusEffect } from "expo-router"
import React from "react"
import { Pressable, View, StyleSheet, TextInput } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ThemedText } from "@/components/ThemedText"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { shoppingListService } from "@/api/shopping-list-service"

export default function NewShoppingList() {
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

  const createShoppingList = async (listName: string) => {
    const result = await shoppingListService.createList(listName)

    if (!result.success) {
      const error = result.getError()
      setInvalidInputExplanation(error.message)
      return
    }

    const listId = result.getValue()
    onChangeText("")
    router.replace(`/view_shopping_list?listId=${listId}`)
  }

  if (invalidInputExplanation && text.trim()) {
    setInvalidInputExplanation("")
  }

  return (
    <SafeAreaView style={styles.containerStyle}>
      <View style={styles.searchBarContainer}>
        <ThemedTextInput
          ref={inputRef}
          onSubmit={() => createShoppingList(text)}
          onChangeText={onChangeText}
          value={text}
          placeholder="Shopping list name"
          borderColor={invalidInputExplanation ? "red" : undefined}
        />

        <Pressable
          style={styles.buttonStyle}
          onPress={() => createShoppingList(text)}
        >
          <ThemedText>Create</ThemedText>
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
