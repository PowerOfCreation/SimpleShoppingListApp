import { ActionButton } from "@/components/ActionButton"
import { Palette } from "@/constants/Colors"
import { Entry } from "@/components/Entry"
import React from "react"
import {
  FlatList,
  StyleSheet,
  ActivityIndicator,
  View,
  TouchableOpacity,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect, useNavigation } from "expo-router"
import { MaterialIcons } from "@expo/vector-icons"
import { setPreference } from "@/database/preferences-repository"

import { Ingredient } from "@/types/Ingredient"
import { ThemedText } from "@/components/ThemedText"
import { SystemMessage } from "@/components/SystemMessage"
import { useIngredients } from "@/hooks/useIngredients"
import { useThemeColor } from "@/hooks/useThemeColor"
import { formatSortMode } from "@/utils/sortIngredients"

export default function ViewShoppingList() {
  const {
    ingredients,
    isLoading,
    error,
    refetch,
    listName,
    listId,
    sortMode,
    sortSignal,
    toggleCompletion,
    updateName,
    deleteIngredient,
    sortIngredients,
  } = useIngredients()
  const [ingredientToEdit, setIngredientToEdit] = React.useState<string>("")
  const [sortModeMessage, setSortModeMessage] = React.useState<string | null>(
    null
  )
  const isFirstSortModeRender = React.useRef(true)
  const isFirstSortSignalRender = React.useRef(true)
  const navigation = useNavigation()
  const dividerColor = useThemeColor({}, "divider")

  React.useEffect(() => {
    if (listId) {
      setPreference("last_viewed_list_id", listId)
    }
  }, [listId])

  // Announce the active sort mode whenever the user switches it,
  // but not on initial mount
  React.useEffect(() => {
    if (isFirstSortModeRender.current) {
      isFirstSortModeRender.current = false
      return
    }
    setSortModeMessage(formatSortMode(sortMode))
  }, [sortMode])

  // Announce a plain re-sort (list was out of order, mode didn't change)
  React.useEffect(() => {
    if (isFirstSortSignalRender.current) {
      isFirstSortSignalRender.current = false
      return
    }
    setSortModeMessage("Sorted")
  }, [sortSignal])

  // Memoize the header right component to avoid recreating on every render
  const headerRightComponent = React.useCallback(
    () => (
      <TouchableOpacity
        onPress={sortIngredients}
        style={styles.sortButton}
        accessibilityLabel="Sort list"
        accessibilityHint="Moves completed items to the bottom"
      >
        <MaterialIcons
          name="sort"
          size={24}
          color="#007AFF"
          style={styles.sortIcon}
        />
      </TouchableOpacity>
    ),
    [sortIngredients]
  )

  // Update header with title and sort button
  React.useEffect(() => {
    navigation.setOptions({
      headerTitle: listName || "",
      headerRight: headerRightComponent,
    })
  }, [listName, navigation, headerRightComponent])

  // Refetch ingredients when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      refetch()
    }, [refetch])
  )

  const handleChangeName = async (id: string, newName: string) => {
    setIngredientToEdit("")
    await updateName(id, newName)
  }

  const handleDeleteIngredient = async (id: string) => {
    setIngredientToEdit("")
    await deleteIngredient(id)
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
        priority={item.priority}
        onToggleComplete={() => toggleCompletion(item.id)}
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
          Press the &apos;+&apos; button at the bottom right to add your first
          product.
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
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={[styles.headerDivider, { backgroundColor: dividerColor }]} />
      <SystemMessage
        message={sortModeMessage}
        onHide={() => setSortModeMessage(null)}
      />
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
  headerDivider: {
    height: 1,
    width: "100%",
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
    color: Palette.error,
    textAlign: "center",
  },
  sortButton: {
    marginRight: 16,
    padding: 4,
  },
  sortIcon: {
    transform: [{ scaleX: -1 }],
  },
})
