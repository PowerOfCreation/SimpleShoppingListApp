import React from "react"
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native"

import { ThemedText } from "./ThemedText"
import { ConfirmDialog } from "./ConfirmDialog"
import { useThemeColor } from "@/hooks/useThemeColor"
import {
  formatInviteCreatedAt,
  formatInviteExpiry,
} from "@/utils/inviteFormatting"

export type InviteEntryProps = {
  inviteId: string
  createdAt: number | null
  expiresAt: number | null
  /** Reference time for the relative expiry - see formatInviteExpiry. */
  now: number
  revoking?: boolean
  onRevoke: () => void
}

/**
 * One active invite link.
 *
 * There is deliberately no way to show or re-copy the link itself: the
 * plaintext token exists only in the response that created it
 * (sync-sharing-target.md §4.3). What is left afterwards is what this row
 * offers - see when it was made, when it dies on its own, and end it early.
 */
export function InviteEntry(props: InviteEntryProps) {
  const [showRevokeConfirm, setShowRevokeConfirm] = React.useState(false)

  const dividerColor = useThemeColor({}, "divider")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")

  return (
    <>
      <View
        testID={`invite-entry-${props.inviteId}`}
        style={[styles.row, { borderBottomColor: dividerColor }]}
      >
        <View style={styles.info}>
          <ThemedText type="defaultSemiBold" style={styles.expiry}>
            {formatInviteExpiry(props.expiresAt, props.now)}
          </ThemedText>
          <ThemedText style={[styles.created, { color: textSecondaryColor }]}>
            {formatInviteCreatedAt(props.createdAt)}
          </ThemedText>
        </View>
        {props.revoking ? (
          <ActivityIndicator
            testID={`invite-revoking-${props.inviteId}`}
            size="small"
          />
        ) : (
          <Pressable
            testID={`invite-revoke-${props.inviteId}`}
            accessibilityRole="button"
            accessibilityLabel="Revoke invite link"
            onPress={() => setShowRevokeConfirm(true)}
            style={styles.revokeButton}
          >
            <ThemedText style={[styles.revokeLabel, { color: dangerColor }]}>
              Revoke
            </ThemedText>
          </Pressable>
        )}
      </View>
      <ConfirmDialog
        testID={`invite-revoke-confirm-${props.inviteId}`}
        visible={showRevokeConfirm}
        title="Revoke this link?"
        message="Anyone who still has this link will no longer be able to join. People who already joined keep their access."
        confirmLabel="Revoke"
        destructive
        onClose={() => setShowRevokeConfirm(false)}
        onConfirm={props.onRevoke}
      />
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  info: {
    flex: 1,
    paddingRight: 12,
  },
  expiry: {
    fontSize: 14.5,
  },
  created: {
    fontSize: 12,
    marginTop: 2,
  },
  revokeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  revokeLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
})
