import React from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useLocalSearchParams } from "expo-router"

import { useAuth } from "@/api/auth/AuthProvider"
import { createLogger } from "@/api/common/logger"
import { SharingError } from "@/api/common/error-types"
import { isSharingConfigured } from "@/api/sharing/config"
import { RedeemedInvite, sharingClient } from "@/api/sharing/sharing-client"
import { describeSharingError } from "@/hooks/useListInvites"
import { PrimaryButton } from "@/components/PrimaryButton"
import { ThemedText } from "@/components/ThemedText"
import { useThemeColor } from "@/hooks/useThemeColor"

const logger = createLogger("Invite")

/**
 * Where the `static.ops.light-dev-solutions.de/invite?token=...` App Link
 * (built by api/sharing/invite-link.ts) actually lands. Joining is one call
 * to POST /invites/redeem (sync-sharing-target.md §5) - it does not yet pull
 * the list's content, so a fresh join has nothing to show locally until that
 * piece exists.
 */
export default function Invite() {
  const { token } = useLocalSearchParams<{ token?: string }>()
  const { status } = useAuth()
  const isSignedIn = status === "signedIn"
  const configured = isSharingConfigured()

  const [isRedeeming, setIsRedeeming] = React.useState(false)
  const [result, setResult] = React.useState<RedeemedInvite | null>(null)
  const [error, setError] = React.useState<SharingError | null>(null)

  const backgroundColor = useThemeColor({}, "background")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")

  const handleJoin = React.useCallback(async () => {
    if (!token) return
    setIsRedeeming(true)
    const redeemResult = await sharingClient.redeemInvite(token)
    if (redeemResult.success) {
      setResult(redeemResult.getValue())
      setError(null)
    } else {
      const sharingError = redeemResult.getError()
      logger.warn("Could not redeem the invite", sharingError)
      setError(sharingError)
    }
    setIsRedeeming(false)
  }, [token])

  const renderUnavailable = (message: string) => (
    <ThemedText
      testID="invite-unavailable"
      style={[styles.hint, { color: textSecondaryColor }]}
    >
      {message}
    </ThemedText>
  )

  const renderContent = () => {
    if (!token) {
      return renderUnavailable("This invite link is missing its token.")
    }
    if (!configured) {
      return renderUnavailable(
        "Sharing needs a backend. Set EXPO_PUBLIC_API_URL to enable it."
      )
    }
    // Restoring the session is not "signed out" - saying so would flash the
    // wrong answer on every cold start.
    if (status === "loading") {
      return (
        <ActivityIndicator
          testID="invite-auth-loading"
          size="small"
          style={styles.loader}
        />
      )
    }
    if (!isSignedIn) {
      return renderUnavailable("Sign in to join this list.")
    }

    if (result) {
      return (
        <ThemedText testID="invite-success" style={styles.hint}>
          {result.alreadyMember
            ? "You are already a member of this list."
            : "You joined this list."}
        </ThemedText>
      )
    }

    return (
      <>
        <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
          You have been invited to join a shopping list.
        </ThemedText>
        <PrimaryButton
          testID="invite-join"
          label="Join this list"
          loading={isRedeeming}
          onPress={handleJoin}
        />
        {error ? (
          <ThemedText
            testID="invite-error"
            style={[styles.error, { color: dangerColor }]}
          >
            {describeSharingError(error)}
          </ThemedText>
        ) : null}
      </>
    )
  }

  return (
    <SafeAreaView
      testID="invite-screen"
      edges={["bottom"]}
      style={[styles.container, { backgroundColor }]}
    >
      <View style={styles.content}>{renderContent()}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 12,
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
    marginTop: 4,
  },
})
