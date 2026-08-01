import { router, useFocusEffect } from "expo-router"
import React from "react"
import { Switch, View, StyleSheet, TextInput } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ThemedText } from "@/components/ThemedText"
import { PrimaryButton } from "@/components/PrimaryButton"
import { Palette } from "@/constants/Colors"
import { useThemeColor } from "@/hooks/useThemeColor"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { shoppingListService } from "@/api/shopping-list-service"
import { useAuth } from "@/api/auth/AuthProvider"

export default function NewShoppingList() {
  const [text, onChangeText] = React.useState("")
  const [syncEnabled, setSyncEnabled] = React.useState(false)
  const [invalidInputExplanation, setInvalidInputExplanation] =
    React.useState("")
  const [creating, setCreating] = React.useState(false)
  const inputRef = React.useRef<TextInput>(null)

  const { status } = useAuth()
  const isSignedIn = status === "signedIn"

  const accentColor = useThemeColor({}, "accent")
  const dividerColor = useThemeColor({}, "divider")
  const dividerSubtleColor = useThemeColor({}, "dividerSubtle")
  const textSecondaryColor = useThemeColor({}, "textSecondary")

  // A signed-out user can't have toggled this meaningfully - the switch is
  // disabled and shown off in that state, regardless of whatever value was
  // left over from being signed in earlier.
  const effectiveSyncEnabled = isSignedIn && syncEnabled

  useFocusEffect(
    React.useCallback(() => {
      const id = setTimeout(() => {
        inputRef.current?.focus()
      }, 100) // we don't know when page is fully loaded on android, so we just wait a bit before focusing
      return () => clearTimeout(id)
    }, [])
  )

  const handleChangeText = (value: string) => {
    onChangeText(value)
    if (invalidInputExplanation && value.trim()) {
      setInvalidInputExplanation("")
    }
  }

  const createShoppingList = async (listName: string) => {
    if (creating) {
      return
    }
    setCreating(true)
    try {
      const result = await shoppingListService.createList(
        listName,
        effectiveSyncEnabled
      )

      if (!result.success) {
        setInvalidInputExplanation(result.getError().message)
        return
      }

      const listId = result.getValue()
      onChangeText("")
      setSyncEnabled(false)
      router.replace(`/view_shopping_list?listId=${listId}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <SafeAreaView style={styles.containerStyle}>
      <ThemedText style={[styles.sectionLabel, { color: textSecondaryColor }]}>
        List name
      </ThemedText>
      <ThemedTextInput
        ref={inputRef}
        onSubmit={() => createShoppingList(text)}
        onChangeText={handleChangeText}
        value={text}
        placeholder="Shopping list name"
        borderColor={invalidInputExplanation ? "red" : undefined}
      />
      {invalidInputExplanation ? (
        <ThemedText style={styles.invalidInputExplanationStyle}>
          {invalidInputExplanation}
        </ThemedText>
      ) : null}

      <View
        style={[
          styles.syncRow,
          { borderTopColor: dividerColor, borderBottomColor: dividerColor },
        ]}
      >
        <View style={styles.syncTextContainer}>
          <ThemedText style={styles.syncTitle}>Sync with account</ThemedText>
          <ThemedText
            style={[styles.syncSubtitle, { color: textSecondaryColor }]}
          >
            {isSignedIn
              ? "Available on all devices, shareable with others"
              : "Sign in to sync lists across devices"}
          </ThemedText>
        </View>
        <Switch
          testID="sync-with-account-switch"
          accessibilityLabel="Sync with account"
          value={effectiveSyncEnabled}
          onValueChange={setSyncEnabled}
          disabled={!isSignedIn}
          trackColor={{ false: dividerSubtleColor, true: accentColor }}
          thumbColor="#ffffff"
        />
      </View>

      <View style={styles.createButtonContainer}>
        <PrimaryButton
          testID="create-list-button"
          label="Create"
          onPress={() => createShoppingList(text)}
          loading={creating}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  containerStyle: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  invalidInputExplanationStyle: {
    color: Palette.error,
    marginTop: 8,
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 14,
    marginTop: 22,
  },
  syncTextContainer: {
    flex: 1,
    paddingRight: 12,
  },
  syncTitle: {
    fontSize: 14.5,
    fontWeight: "600",
  },
  syncSubtitle: {
    fontSize: 11.5,
    marginTop: 2,
  },
  createButtonContainer: {
    marginTop: 24,
  },
})
