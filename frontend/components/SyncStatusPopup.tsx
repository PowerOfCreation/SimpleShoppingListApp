import React, { useState, useSyncExternalStore } from "react"
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native"
import { getSyncDetails, onSyncStatusChanged } from "@/api/sync/sync-status"
import { useThemeColor } from "@/hooks/useThemeColor"
import { ThemedText } from "./ThemedText"
import { Palette } from "@/constants/Colors"

export function SyncStatusPopup({
  children,
  offline,
}: {
  children: React.ReactNode
  offline: boolean
}) {
  const [visible, setVisible] = useState(false)
  const details = useSyncExternalStore(onSyncStatusChanged, getSyncDetails)
  const surface = useThemeColor({}, "surface")
  const accent = useThemeColor({}, "accent")
  const formatTime = (value: number | null) =>
    value === null ? "Not yet" : new Date(value).toLocaleString()

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show sync information"
        onPress={() => setVisible(true)}
        style={styles.trigger}
      >
        {children}
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close sync information"
            accessibilityRole="button"
            style={StyleSheet.absoluteFill}
            onPress={() => setVisible(false)}
          />
          <View
            accessibilityViewIsModal
            style={[styles.popup, { backgroundColor: surface }]}
          >
            <ScrollView>
              <ThemedText type="defaultSemiBold">Sync information</ThemedText>
              <ThemedText style={styles.note}>Current app session</ThemedText>
              <ThemedText style={styles.row}>
                Last sync attempt: {"\n"}
                {formatTime(details.lastAttemptAt)}
              </ThemedText>
              <ThemedText style={styles.row}>
                Last successful sync: {"\n"}
                {formatTime(details.lastSuccessAt)}
              </ThemedText>
              {offline ? (
                <ThemedText style={styles.row}>Offline</ThemedText>
              ) : details.status === "syncing" ? (
                <ThemedText style={styles.row}>Syncing…</ThemedText>
              ) : null}
              {details.error && (
                <ThemedText style={styles.row}>{details.error}</ThemedText>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => setVisible(false)}
                style={styles.close}
              >
                <ThemedText style={{ color: accent }}>Close</ThemedText>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: Palette.overlay,
  },
  popup: {
    width: "100%",
    maxWidth: 340,
    maxHeight: "80%",
    borderRadius: 16,
    padding: 20,
  },
  note: { fontSize: 12, opacity: 0.65 },
  row: { marginTop: 12 },
  close: { alignSelf: "flex-end", padding: 10, marginTop: 12 },
})
