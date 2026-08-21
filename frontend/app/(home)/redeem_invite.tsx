import React from "react"
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router } from "expo-router"

import { useAuth } from "@/api/auth/AuthProvider"
import { isSharingConfigured } from "@/api/sharing/config"
import { extractInviteToken } from "@/api/sharing/invite-link"
import { useSyncEngine } from "@/api/sync/SyncProvider"
import { PrimaryButton } from "@/components/PrimaryButton"
import { ThemedText } from "@/components/ThemedText"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { useRedeemInvite } from "@/hooks/useRedeemInvite"
import { useThemeColor } from "@/hooks/useThemeColor"

/**
 * Joins a shared list from an invite link or raw token, pasted in by hand.
 *
 * Reached only from the "Join a shared list" action on the home screen -
 * not from a system deep link. The invite link uses the app's custom
 * scheme, which isn't domain-verified, so auto-opening this screen from a
 * tapped link would trust whichever app the OS resolves that scheme to.
 * See the note on INVITE_PATH in api/sharing/invite-link.ts.
 */
export default function RedeemInvite() {
  const { status } = useAuth()
  const isSignedIn = status === "signedIn"
  const configured = isSharingConfigured()
  const engine = useSyncEngine()
  const canRedeem = isSignedIn && configured

  const [input, setInput] = React.useState("")
  const {
    status: redeemStatus,
    errorMessage,
    result,
    redeem,
  } = useRedeemInvite(canRedeem, engine)

  const backgroundColor = useThemeColor({}, "background")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")

  const isBusy = redeemStatus === "redeeming" || redeemStatus === "syncing"

  const handleJoin = () => {
    const token = extractInviteToken(input)
    if (!token) return
    redeem(token)
  }

  const handleGoToList = () => {
    if (!result) return
    router.replace(`/view_shopping_list?listId=${result.listId}`)
  }

  const renderUnavailable = (message: string) => (
    <ThemedText
      testID="redeem-unavailable"
      style={[styles.hint, { color: textSecondaryColor }]}
    >
      {message}
    </ThemedText>
  )

  const renderContent = () => {
    if (!configured) {
      return renderUnavailable(
        "Joining a shared list needs a backend. Set EXPO_PUBLIC_API_URL to enable it."
      )
    }
    if (status === "loading") {
      return (
        <ActivityIndicator
          testID="redeem-auth-loading"
          size="small"
          style={styles.loader}
        />
      )
    }
    if (!isSignedIn) {
      return renderUnavailable("Sign in to join a shared list.")
    }

    if (redeemStatus === "success" && result) {
      return (
        <View style={styles.section}>
          <ThemedText type="subtitle">
            {result.alreadyMember ? "You're already in" : "You're in!"}
          </ThemedText>
          <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
            {result.alreadyMember
              ? "You were already a member of this list."
              : "You joined the list. It may take a moment to appear with its full contents."}
          </ThemedText>
          <PrimaryButton
            testID="redeem-go-to-list"
            label="Go to list"
            onPress={handleGoToList}
          />
        </View>
      )
    }

    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Join a shared list</ThemedText>
        <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
          Paste the invite link or code someone sent you.
        </ThemedText>
        <ThemedTextInput
          testID="redeem-token-input"
          value={input}
          onChangeText={setInput}
          onSubmit={handleJoin}
          placeholder="Invite link or code"
          autoFocus
        />
        <PrimaryButton
          testID="redeem-join"
          label="Join list"
          loading={isBusy}
          disabled={!input.trim()}
          onPress={handleJoin}
        />
        {redeemStatus === "error" && errorMessage ? (
          <ThemedText
            testID="redeem-error"
            style={[styles.error, { color: dangerColor }]}
          >
            {errorMessage}
          </ThemedText>
        ) : null}
      </View>
    )
  }

  return (
    <SafeAreaView
      testID="redeem-invite-screen"
      edges={["bottom"]}
      style={[styles.container, { backgroundColor }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 4,
  },
  section: {
    gap: 12,
    paddingVertical: 8,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
  },
  loader: {
    alignSelf: "flex-start",
    marginVertical: 8,
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
  },
})
