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
    setPriority,
    clearPriority,
    deleteIngredient,
    sortIngredients,
  } = useIngredients()
  const [sortModeMessage, setSortModeMessage] = React.useState<string | null>(
    null
  )
  const isFirstSortModeRender = React.useRef(true)
  const isFirstSortSignalRender = React.useRef(true)
  const navigation = useNavigation()
  const dividerColor = useThemeColor({}, "divider")
  const backgroundColor = useThemeColor({}, "background")
  const accentColor = useThemeColor({}, "accent")
  const textColor = useThemeColor({}, "text")
  const completedCount = ingredients.filter((item) => item.completed).length

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
          color={textColor}
          style={styles.sortIcon}
        />
      </TouchableOpacity>
    ),
    [sortIngredients, textColor]
  )

  // Update header with title and sort button
  React.useEffect(() => {
    navigation.setOptions({
      headerTitle: "Lists",
      headerTitleStyle: { fontSize: 17, fontWeight: "400" },
      headerBackTitle: "Lists",
      headerShadowVisible: false,
      headerRight: headerRightComponent,
    })
  }, [listName, navigation, headerRightComponent])

  // Refetch ingredients when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      refetch()
    }, [refetch])
  )

  const renderEntry = ({ item }: { item: Ingredient }) => {
    return (
      <Entry
        id={item.id}
        ingredientName={item.name}
        isCompleted={item.completed}
        priority={item.priority}
        onToggleComplete={() => toggleCompletion(item.id)}
        onRename={(newName) => updateName(item.id, newName)}
        onDelete={() => deleteIngredient(item.id)}
        onSetPriority={(priority) => setPriority(item.id, priority)}
        onClearPriority={() => clearPriority(item.id)}
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
          Add your first item with “Add item”.
        </ThemedText>
      )
    }

    return (
      <FlatList
        contentContainerStyle={styles.listContent}
        data={ingredients}
        renderItem={renderEntry}
        keyExtractor={(item) => item.id}
        extraData={error}
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
      />
    )
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["bottom"]}
    >
      <View style={styles.summary}>
        <ThemedText type="title" style={styles.title}>
          {listName}
        </ThemedText>
        <View style={styles.progressRow}>
          <ThemedText>
            <ThemedText type="defaultSemiBold">
              {ingredients.length - completedCount} open
            </ThemedText>{" "}
            / {ingredients.length} items
          </ThemedText>
          <View
            style={[styles.progressTrack, { backgroundColor: dividerColor }]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: accentColor,
                  width: `${ingredients.length ? (completedCount / ingredients.length) * 100 : 0}%`,
                },
              ]}
            />
          </View>
        </View>
        <TouchableOpacity
          testID="add-button"
          accessibilityRole="button"
          style={[styles.addButton, { borderColor: dividerColor }]}
          onPress={() =>
            router.push({ pathname: "/new_ingredient", params: { listId } })
          }
        >
          <MaterialIcons name="add" size={28} color={textColor} />
          <ThemedText style={styles.addLabel}>Add item</ThemedText>
        </TouchableOpacity>
      </View>
      <SystemMessage
        message={sortModeMessage}
        onHide={() => setSortModeMessage(null)}
      />
      {renderContent()}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  summary: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 20 },
  title: { fontSize: 32, lineHeight: 40, marginBottom: 26 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    marginBottom: 32,
  },
  progressTrack: { flex: 1, height: 7, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%" },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderRadius: 7,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  addLabel: { fontSize: 17 },
  listContent: { paddingHorizontal: 22, paddingBottom: 24 },
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
