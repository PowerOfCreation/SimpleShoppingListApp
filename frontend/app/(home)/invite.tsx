import React from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useLocalSearchParams } from "expo-router"

import { useAuth } from "@/api/auth/AuthProvider"
import { isSharingConfigured } from "@/api/sharing/config"
import { PrimaryButton } from "@/components/PrimaryButton"
import { ThemedText } from "@/components/ThemedText"
import { useRedeemInvite } from "@/hooks/useRedeemInvite"
import { useThemeColor } from "@/hooks/useThemeColor"

/**
 * Landing screen for a tapped invite link
 * (https://static.ops.light-dev-solutions.de/invite?token=...,
 * INVITE_PATH in invite-link.ts). Reachable while signed out - the app
 * itself needs no login - so this is the one place that has to ask for one
 * before it can do anything, rather than hiding the entry point like
 * share_shopping_list does.
 */
export default function Invite() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { status, login } = useAuth()
  const isSignedIn = status === "signedIn"
  const configured = isSharingConfigured()

  const {
    status: redeemStatus,
    errorMessage,
    listId,
    alreadyMember,
    redeem,
  } = useRedeemInvite()

  const hasStartedRef = React.useRef(false)
  React.useEffect(() => {
    if (hasStartedRef.current || !token || !isSignedIn || !configured) return
    hasStartedRef.current = true
    redeem(token)
  }, [token, isSignedIn, configured, redeem])

  const backgroundColor = useThemeColor({}, "background")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")

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
      return renderUnavailable("This link is missing its invite token.")
    }
    if (!configured) {
      return renderUnavailable(
        "Joining needs a backend. Set EXPO_PUBLIC_API_URL to enable it."
      )
    }
    if (status === "loading") {
      return <ActivityIndicator testID="invite-auth-loading" size="large" />
    }
    if (!isSignedIn) {
      return (
        <>
          <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
            Sign in to join this list.
          </ThemedText>
          <PrimaryButton
            testID="invite-login"
            label="Sign in with Keycloak"
            onPress={login}
          />
        </>
      )
    }

    if (redeemStatus === "idle" || redeemStatus === "working") {
      return (
        <>
          <ActivityIndicator testID="invite-working" size="large" />
          <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
            Joining list...
          </ThemedText>
        </>
      )
    }

    if (redeemStatus === "error") {
      return (
        <>
          <ThemedText
            testID="invite-error"
            style={[styles.hint, { color: dangerColor }]}
          >
            {errorMessage}
          </ThemedText>
          <PrimaryButton
            testID="invite-retry"
            label="Try again"
            onPress={() => redeem(token)}
          />
        </>
      )
    }

    if (redeemStatus === "pending") {
      return (
        <>
          <ThemedText testID="invite-pending" style={styles.hint}>
            You joined the list. It will finish downloading once this device is
            back online.
          </ThemedText>
          <PrimaryButton
            testID="invite-go-to-lists"
            label="Go to Shopping Lists"
            onPress={() => router.replace("/(home)")}
          />
        </>
      )
    }

    return (
      <>
        <ThemedText testID="invite-joined" type="subtitle">
          {alreadyMember
            ? "You're already a member of this list."
            : "You've joined the list."}
        </ThemedText>
        <PrimaryButton
          testID="invite-open-list"
          label="Open list"
          onPress={() => router.replace(`/view_shopping_list?listId=${listId}`)}
        />
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
    flex: 1,
    padding: 20,
    gap: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
})
