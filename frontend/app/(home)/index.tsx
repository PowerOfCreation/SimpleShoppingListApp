import { ActionButton } from "@/components/ActionButton"
import { Palette } from "@/constants/Colors"
import React from "react"
import { FlatList, StyleSheet, ActivityIndicator, View } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { getPreference } from "@/database/preferences-repository"

import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import { ThemedText } from "@/components/ThemedText"
import { DrawerToggleButton } from "@/components/DrawerToggleButton"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { useShoppingLists } from "@/hooks/useShoppingLists"
import { useSyncStatus } from "@/hooks/useSyncStatus"
import { useThemeColor } from "@/hooks/useThemeColor"
import { ShoppingListEntry } from "@/components/ShoppingListEntry"
import { getShoppingListService } from "@/api/shopping-list-service"
import { createLogger } from "@/api/common/logger"
import { useAuth } from "@/api/auth/AuthProvider"
import { useSyncEngine } from "@/api/sync/SyncProvider"
import {
  sharedSyncWarning,
  useSharedSyncedLists,
} from "@/hooks/useSharedSyncedLists"

const logger = createLogger("Index")

export default function Index() {
  const { lists, isLoading, error, refetch, updateList } = useShoppingLists()
  const syncEngine = useSyncEngine()
  const backgroundColor = useThemeColor({}, "background")
  const textColor = useThemeColor({}, "text")
  const accentColor = useThemeColor({}, "accent")
  const dangerColor = useThemeColor({}, "danger")
  const [isCheckingPreference, setIsCheckingPreference] = React.useState(true)
  const hasNavigatedRef = React.useRef(false)
  const { status } = useAuth()
  const isSignedIn = status === "signedIn"
  const syncStatus = useSyncStatus()
  const { load: loadSharedSyncedLists } = useSharedSyncedLists()
  const [syncOffConfirmId, setSyncOffConfirmId] = React.useState<string | null>(
    null
  )

  React.useEffect(() => {
    if (hasNavigatedRef.current || isLoading) return
    getPreference("last_viewed_list_id").then((lastId) => {
      hasNavigatedRef.current = true
      if (lastId && lists.some((l) => l.id === lastId)) {
        router.push(`/view_shopping_list?listId=${lastId}`)
      }
      setIsCheckingPreference(false)
    })
  }, [isLoading, lists])

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

    try {
      const result = await getShoppingListService().updateName(id, newName)
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

  const handleDeleteList = async (id: string) => {
    const list = lists.find((l) => l.id === id)
    if (!list) return

    try {
      const result = await getShoppingListService().deleteList(id)
      if (result.success) {
        // Refetch to update the UI
        await refetch()
      } else {
        logger.error("Error deleting list", result.getError())
      }
    } catch (err) {
      logger.error("Error deleting list", err)
    }
  }

  const applyToggleSync = async (id: string, enabled: boolean) => {
    const list = lists.find((l) => l.id === id)
    if (!list) return

    // Optimistically update UI immediately
    const previous = list.syncEnabled
    updateList(id, { syncEnabled: enabled })

    try {
      const result = await getShoppingListService().setSyncEnabled(id, enabled)
      if (!result.success) {
        // Revert optimistic update on error
        updateList(id, { syncEnabled: previous })
      }
    } catch (err) {
      logger.error("Error toggling sync for list", err)
      // Revert optimistic update on error
      updateList(id, { syncEnabled: previous })
    }
  }

  const handleToggleSync = async (id: string, enabled: boolean) => {
    if (enabled) {
      await applyToggleSync(id, true)
      return
    }

    const list = lists.find((l) => l.id === id)
    if (!list) return

    // Turning sync off is purely local - the server copy and any members
    // keep working. Warn first, same as sign-out's warning, since the owner
    // otherwise has no way to notice they'd stop seeing a shared list's
    // updates. A failed check (shared === null) can't rule out sharing, so
    // it's treated the same as "shared" rather than skipping the warning.
    const shared = await loadSharedSyncedLists(id)
    if (shared === null || shared.length > 0) {
      setSyncOffConfirmId(id)
      return
    }

    await applyToggleSync(id, false)
  }

  const handleConfirmSyncOff = () => {
    if (!syncOffConfirmId) return
    applyToggleSync(syncOffConfirmId, false)
  }

  const handleShareList = (id: string) => {
    const list = lists.find((l) => l.id === id)
    if (!list) return

    // The name travels as a param so the invite screen can show which list
    // it is talking about without another query - it never needs the list's
    // content, only its id.
    router.push({
      pathname: "/share_shopping_list",
      params: { listId: id, listName: list.name },
    })
  }

  const handleResync = async (id: string) => {
    try {
      await syncEngine.repairList(id)
      // The repair pull may have changed this list's content/name locally.
      await refetch()
    } catch (err) {
      logger.error("Error re-syncing list from server", err)
    }
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
        onRename={(newName) => handleChangeName(item.id, newName)}
        onDelete={() => handleDeleteList(item.id)}
        syncEnabled={item.syncEnabled}
        onToggleSync={(enabled) => handleToggleSync(item.id, enabled)}
        syncToggleDisabled={!isSignedIn}
        onResync={() => handleResync(item.id)}
        onShare={() => handleShareList(item.id)}
      />
    )
  }

  const handleAddList = () => {
    router.push("/new_shopping_list")
  }

  const renderContent = () => {
    if (isLoading || isCheckingPreference) {
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
          Create your first shopping list with “New list”.
        </ThemedText>
      )
    }

    return (
      <FlatList
        contentContainerStyle={styles.listContent}
        data={lists}
        renderItem={renderListItem}
        keyExtractor={(item) => item.id}
        extraData={error}
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
      />
    )
  }

  // Re-derived from `lists` on every render instead of snapshotted at
  // click-time, so a rename that lands while the dialog is open is reflected.
  const syncOffConfirmName = syncOffConfirmId
    ? lists.find((l) => l.id === syncOffConfirmId)?.name
    : undefined

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.header}>
        <DrawerToggleButton tintColor={textColor} style={styles.menuButton} />
        <View style={styles.titleRow}>
          <ThemedText type="title" style={styles.headerTitle}>
            My lists
          </ThemedText>
          {isSignedIn &&
            (syncStatus === "syncing" ? (
              <ActivityIndicator
                testID="sync-status-icon-syncing"
                size="small"
                color={accentColor}
                style={styles.syncStatusIcon}
              />
            ) : (
              <MaterialIcons
                testID={
                  syncStatus === "error"
                    ? "sync-status-icon-error"
                    : "sync-status-icon-synced"
                }
                name={syncStatus === "error" ? "error" : "cloud-done"}
                size={22}
                color={syncStatus === "error" ? dangerColor : accentColor}
                style={styles.syncStatusIcon}
              />
            ))}
        </View>
      </View>
      {renderContent()}
      <ActionButton
        testID="add-button"
        symbol="+"
        label="New list"
        onPress={handleAddList}
      />
      <ConfirmDialog
        testID="sync-off-confirm"
        visible={syncOffConfirmId !== null}
        title="Turn off sync?"
        message={
          syncOffConfirmName
            ? sharedSyncWarning(
                "Turning off sync stops further updates on this device.",
                [syncOffConfirmName]
              )
            : ""
        }
        confirmLabel="Turn off sync"
        destructive
        onClose={() => setSyncOffConfirmId(null)}
        onConfirm={handleConfirmSyncOff}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  menuButton: {
    marginLeft: -4,
    alignSelf: "flex-start",
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    marginTop: 12,
    fontSize: 34,
    lineHeight: 42,
  },
  syncStatusIcon: {
    marginLeft: 10,
    marginTop: 12,
  },
  listContent: { paddingHorizontal: 22, paddingBottom: 110 },
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
})
