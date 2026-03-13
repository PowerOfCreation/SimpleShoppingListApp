import { ActionButton } from "@/components/ActionButton"
import React from "react"
import {
  FlatList,
  StyleSheet,
  ActivityIndicator,
  View,
  TouchableOpacity,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"

import { IngredientList } from "@/types/IngredientList"
import { ThemedText } from "@/components/ThemedText"
import { useShoppingLists } from "@/hooks/useShoppingLists"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("Index")

export default function Index() {
  const { lists, isLoading, error, refetch } = useShoppingLists()

  // Refetch shopping lists when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      refetch()
    }, [refetch])
  )
  const handleSelectList = (id: string) => {
    router.push(`/view_shopping_list?listId=${id}`)
  }

  const renderListItem = ({ item }: { item: IngredientList }) => {
    return (
      <TouchableOpacity
        onPress={() => handleSelectList(item.id)}
        style={styles.listItem}
      >
        <ThemedText type="default">{item.name}</ThemedText>
        <ThemedText style={styles.listDate} type="default">
          {new Date(item.created_at || 0).toLocaleDateString()}
        </ThemedText>
      </TouchableOpacity>
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
        extraData={error}
        removeClippedSubviews={false}
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
  listItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  listDate: {
    fontSize: 12,
    marginTop: 4,
    opacity: 0.6,
  },
})
