import React from "react"
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useLocalSearchParams } from "expo-router"

import { useAuth } from "@/api/auth/AuthProvider"
import { isSharingConfigured } from "@/api/sharing/config"
import { PrimaryButton } from "@/components/PrimaryButton"
import { ThemedText } from "@/components/ThemedText"
import { useInvitePreview } from "@/hooks/useInvitePreview"
import { useRedeemInvite } from "@/hooks/useRedeemInvite"
import { useThemeColor } from "@/hooks/useThemeColor"
import { InvitePreview } from "@/api/sharing/sharing-client"

/**
 * Landing screen for a tapped invite link
 * (https://static.ops.light-dev-solutions.de/invite?token=...,
 * INVITE_PATH in invite-link.ts). Reachable while signed out - the app
 * itself needs no login - so this is the one place that has to ask for one
 * before it can do anything, rather than hiding the entry point like
 * share_shopping_list does.
 *
 * Shows an invitation card (list name, member count, inviter + avatar) from
 * POST /invites/preview before joining, then only calls POST /invites/redeem
 * once the user taps "Join list" - unlike the old auto-join behavior.
 */
export default function Invite() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { status, login } = useAuth()
  const isSignedIn = status === "signedIn"
  const configured = isSharingConfigured()

  const {
    status: previewStatus,
    data: preview,
    errorMessage: previewErrorMessage,
    preview: loadPreview,
  } = useInvitePreview()

  const {
    status: redeemStatus,
    errorMessage: redeemErrorMessage,
    listId,
    alreadyMember,
    redeem,
  } = useRedeemInvite()

  const hasStartedRef = React.useRef(false)
  React.useEffect(() => {
    if (hasStartedRef.current || !token || !isSignedIn || !configured) return
    hasStartedRef.current = true
    loadPreview(token)
  }, [token, isSignedIn, configured, loadPreview])

  const backgroundColor = useThemeColor({}, "background")
  const surfaceColor = useThemeColor({}, "surface")
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

  const renderJoinFooter = () => {
    if (redeemStatus === "error") {
      return (
        <>
          <ThemedText
            testID="invite-error"
            style={[styles.hint, { color: dangerColor }]}
          >
            {redeemErrorMessage}
          </ThemedText>
          <PrimaryButton
            testID="invite-retry"
            label="Try again"
            onPress={() => redeem(token)}
          />
        </>
      )
    }

    if (redeemStatus === "working") {
      return (
        <>
          <ActivityIndicator testID="invite-working" size="large" />
          <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
            Joining list...
          </ThemedText>
        </>
      )
    }

    return (
      <>
        <PrimaryButton
          testID="invite-join"
          label="Join list"
          onPress={() => redeem(token)}
        />
        <Pressable
          testID="invite-decline"
          onPress={() => router.replace("/(home)")}
        >
          <ThemedText
            style={[styles.declineText, { color: textSecondaryColor }]}
          >
            Not now
          </ThemedText>
        </Pressable>
      </>
    )
  }

  const renderInvitationCard = (data: InvitePreview) => (
    <View style={[styles.card, { backgroundColor: surfaceColor }]}>
      {data.invitedByPictureURL && (
        <Image
          testID="invite-avatar"
          source={{ uri: data.invitedByPictureURL }}
          style={styles.avatar}
        />
      )}
      <ThemedText
        testID="invite-heading"
        type="subtitle"
        style={styles.heading}
      >
        {(data.invitedByName ?? "Someone") +
          ` invited you to join list "${data.listName}"`}
      </ThemedText>
      <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
        {data.memberCount} member{data.memberCount === 1 ? "" : "s"}
      </ThemedText>
      <View style={styles.footer}>{renderJoinFooter()}</View>
    </View>
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

    if (redeemStatus === "joined") {
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
            onPress={() =>
              router.replace(`/view_shopping_list?listId=${listId}`)
            }
          />
        </>
      )
    }

    if (previewStatus === "idle" || previewStatus === "loading") {
      return (
        <>
          <ActivityIndicator testID="invite-preview-loading" size="large" />
          <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
            Loading invite...
          </ThemedText>
        </>
      )
    }

    if (previewStatus === "error") {
      return renderUnavailable(
        previewErrorMessage ?? "This invite is unavailable."
      )
    }

    return renderInvitationCard(preview!)
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
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    gap: 8,
    alignItems: "center",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 4,
  },
  heading: {
    textAlign: "center",
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  footer: {
    marginTop: 12,
    gap: 12,
    alignItems: "center",
  },
  declineText: {
    fontSize: 14,
    fontWeight: "700",
  },
})
