import { ActionButton } from "@/components/ActionButton"
import React from "react"
import { FlatList, StyleSheet, ActivityIndicator, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"

import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import { ThemedText } from "@/components/ThemedText"
import { useShoppingLists } from "@/hooks/useShoppingLists"
import { ShoppingListEntry } from "@/components/ShoppingListEntry"
import { shoppingListService } from "@/api/shopping-list-service"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("Index")

export default function Index() {
  const { lists, isLoading, error, refetch, updateList } = useShoppingLists()
  const [listToEdit, setListToEdit] = React.useState<string>("")

  // Refetch shopping lists when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      refetch()
    }, [refetch])
  )
  const handleSelectList = (id: string) => {
    router.push(`/view_shopping_list?listId=${id}`)
  }

  const handleChangeName = async (id: string, newName: string) => {
    const list = lists.find((l) => l.id === id)
    if (!list) return

    // Optimistically update UI immediately
    updateList(id, { name: newName })
    setListToEdit("")

    try {
      const result = await shoppingListService.updateName(id, newName)
      if (!result.success) {
        // Revert optimistic update on error
        updateList(id, { name: list.name })
      }
    } catch (err) {
      logger.error("Error changing list name", err)
      // Revert optimistic update on error
      updateList(id, { name: list.name })
    }
  }

  const handleLongPress = (id: string) => {
    setListToEdit(id)
  }

  const renderListItem = ({ item }: { item: ShoppingListOverview }) => {
    return (
      <ShoppingListEntry
        id={item.id}
        listName={item.name}
        createdAt={item.created_at || 0}
        totalCount={item.totalCount}
        completedCount={item.completedCount}
        onPress={() => handleSelectList(item.id)}
        onLongPress={() => handleLongPress(item.id)}
        isEdited={listToEdit === item.id}
        onCancelEditing={() => setListToEdit("")}
        onSaveEditing={async (text) => {
          await handleChangeName(item.id, text)
        }}
      />
    )
  }

  const handleAddList = () => {
    router.push("/new_shopping_list")
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

    if (lists.length === 0) {
      return (
        <ThemedText style={styles.emptyListInfoTextStyle} type="default">
          Press the '+' button at the bottom right to create your first shopping
          list.
        </ThemedText>
      )
    }

    return (
      <FlatList
        data={lists}
        renderItem={renderListItem}
        keyExtractor={(item) => item.id}
        extraData={`${listToEdit}-${error}`}
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
      />
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {renderContent()}
      <ActionButton testID="add-button" symbol="+" onPress={handleAddList} />
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
