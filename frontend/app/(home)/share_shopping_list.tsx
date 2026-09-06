import React from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useLocalSearchParams } from "expo-router"

import { useAuth } from "@/api/auth/AuthProvider"
import { createLogger } from "@/api/common/logger"
import { isSharingConfigured } from "@/api/sharing/config"
import { buildInviteLink } from "@/api/sharing/invite-link"
import { INVITE_TTLS, InviteTTL } from "@/api/sharing/sharing-client"
import { InviteEntry } from "@/components/InviteEntry"
import { PrimaryButton } from "@/components/PrimaryButton"
import { ThemedText } from "@/components/ThemedText"
import { useListInvites } from "@/hooks/useListInvites"
import { useThemeColor } from "@/hooks/useThemeColor"
import { formatInviteTtl } from "@/utils/inviteFormatting"

const logger = createLogger("ShareShoppingList")

const DEFAULT_TTL: InviteTTL = "7d"

/**
 * Invite management for one synchronized list.
 *
 * Reachable only from a list this device syncs while signed in (see the
 * context menu in ShoppingListEntry): sharing needs a list the server
 * actually holds a log for, and the server only learns of one through a
 * push (sync-sharing-target.md §4.2). Being the owner is enforced server
 * side and surfaces here as an error, because the client has no way to ask
 * for its own role yet - GET /todo-lists/:id/membership is still open (§5).
 */
export default function ShareShoppingList() {
  const { listId, listName } = useLocalSearchParams<{
    listId: string
    listName: string
  }>()
  const { status } = useAuth()
  const isSignedIn = status === "signedIn"
  const configured = isSharingConfigured()
  const canManageInvites = Boolean(listId) && isSignedIn && configured

  const [selectedTtl, setSelectedTtl] = React.useState<InviteTTL>(DEFAULT_TTL)

  const {
    invites,
    now,
    isLoading,
    errorMessage,
    createInvite,
    isCreating,
    newInvite,
    dismissNewInvite,
    revokeInvite,
    revokingInviteId,
  } = useListInvites(listId, listName ?? "", canManageInvites)

  const backgroundColor = useThemeColor({}, "background")
  const surfaceColor = useThemeColor({}, "surface")
  const dividerColor = useThemeColor({}, "divider")
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")

  const inviteLink = newInvite ? buildInviteLink(newInvite.token) : null

  const handleShare = React.useCallback(async () => {
    if (!inviteLink) return
    try {
      await Share.share({ message: inviteLink })
    } catch (error) {
      // A dismissed share sheet is not a failure worth showing.
      logger.warn("Could not open the share sheet", error)
    }
  }, [inviteLink])

  const renderUnavailable = (message: string) => (
    <ThemedText
      testID="share-unavailable"
      style={[styles.hint, { color: textSecondaryColor }]}
    >
      {message}
    </ThemedText>
  )

  const renderInvites = () => {
    if (isLoading) {
      return (
        <ActivityIndicator
          testID="invites-loading"
          size="small"
          style={styles.loader}
        />
      )
    }

    // A failed load leaves `invites` empty, and "no active links" stacked on
    // top of "you are not the owner" reads as two different answers to the
    // same question. The error below is the answer.
    if (errorMessage) {
      return null
    }

    if (invites.length === 0) {
      return (
        <ThemedText
          testID="invites-empty"
          style={[styles.hint, { color: textSecondaryColor }]}
        >
          No active invite links. Create one below to let someone join this
          list.
        </ThemedText>
      )
    }

    return invites.map((invite) => (
      <InviteEntry
        key={invite.inviteId}
        inviteId={invite.inviteId}
        createdAt={invite.createdAt}
        expiresAt={invite.expiresAt}
        now={now}
        revoking={revokingInviteId === invite.inviteId}
        onRevoke={() => revokeInvite(invite.inviteId)}
      />
    ))
  }

  const renderContent = () => {
    if (!listId) {
      return renderUnavailable("No list selected.")
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
          testID="share-auth-loading"
          size="small"
          style={styles.loader}
        />
      )
    }
    if (!isSignedIn) {
      return renderUnavailable(
        "Sign in to invite people to a list you synchronize."
      )
    }

    return (
      <>
        <View style={styles.section}>
          <ThemedText type="subtitle">People with access</ThemedText>
          <ThemedText
            testID="share-members-placeholder"
            style={[styles.hint, { color: textSecondaryColor }]}
          >
            You own this list. Everyone who opens an active link below joins as
            a member and can view and edit it - they cannot invite anyone else.
            Showing who has joined needs a backend endpoint that does not exist
            yet.
          </ThemedText>
        </View>

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        <View style={styles.section}>
          <ThemedText type="subtitle">Active invite links</ThemedText>
          {renderInvites()}
        </View>

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        <View style={styles.section}>
          <ThemedText type="subtitle">New invite link</ThemedText>
          <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
            A link can be used by more than one person until it expires.
          </ThemedText>
          <View style={styles.ttlRow}>
            {INVITE_TTLS.map((ttl) => {
              const isSelected = ttl === selectedTtl
              return (
                <Pressable
                  key={ttl}
                  testID={`invite-ttl-${ttl}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setSelectedTtl(ttl)}
                  style={[
                    styles.ttlChip,
                    {
                      borderColor: isSelected ? accentColor : dividerColor,
                      backgroundColor: isSelected
                        ? accentColor
                        : backgroundColor,
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.ttlLabel,
                      isSelected ? { color: onAccentColor } : undefined,
                    ]}
                  >
                    {formatInviteTtl(ttl)}
                  </ThemedText>
                </Pressable>
              )
            })}
          </View>
          <PrimaryButton
            testID="create-invite"
            label="Create invite link"
            loading={isCreating}
            onPress={() => createInvite(selectedTtl)}
          />
        </View>

        {newInvite ? (
          <View
            testID="new-invite-card"
            style={[styles.card, { backgroundColor: surfaceColor }]}
          >
            <ThemedText type="defaultSemiBold">Your new link</ThemedText>
            <ThemedText
              testID="new-invite-link"
              selectable
              style={[styles.link, { color: accentColor }]}
            >
              {inviteLink ?? newInvite.token}
            </ThemedText>
            <ThemedText style={[styles.hint, { color: textSecondaryColor }]}>
              {inviteLink
                ? "This link is shown once and cannot be recovered later. Share it now; you can revoke it above at any time."
                : "This device cannot build a link, so here is the raw token. It is shown once and cannot be recovered later."}
            </ThemedText>
            <View style={styles.cardActions}>
              {inviteLink ? (
                <PrimaryButton
                  testID="share-invite"
                  label="Share link"
                  onPress={handleShare}
                />
              ) : null}
              <Pressable
                testID="dismiss-invite"
                accessibilityRole="button"
                onPress={dismissNewInvite}
                style={styles.dismissButton}
              >
                <ThemedText style={{ color: textSecondaryColor }}>
                  Done
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}

        {errorMessage ? (
          <ThemedText
            testID="share-error"
            style={[styles.error, { color: dangerColor }]}
          >
            {errorMessage}
          </ThemedText>
        ) : null}
      </>
    )
  }

  return (
    <SafeAreaView
      testID="share-shopping-list-screen"
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
    gap: 8,
    paddingVertical: 8,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
  },
  loader: {
    alignSelf: "flex-start",
    marginVertical: 8,
  },
  ttlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ttlChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  ttlLabel: {
    fontSize: 14,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    gap: 8,
  },
  link: {
    fontSize: 13,
    lineHeight: 19,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  dismissButton: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
})
