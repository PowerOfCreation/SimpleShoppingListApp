import { isSyncConfigured, syncConfig } from "@/api/sync/config"

/**
 * Sharing lives on the same backend as sync and is configured by the same
 * EXPO_PUBLIC_API_URL - there is no separate switch. It is re-exported under
 * its own name so the sharing screens read as what they are ("is sharing
 * available") instead of reaching into sync's config for an answer that only
 * incidentally comes from there.
 */
export const isSharingConfigured = isSyncConfigured

/**
 * The `todo-lists` path segment is historical: the table of that name no
 * longer exists, the route addresses a list id in the server's registry (see
 * frontend/docs/sync-sharing-target.md §5). Renaming it is a client-breaking
 * change and is deliberately not done here.
 */
export const sharingConfig = {
  listInvitesUrl(listId: string): string {
    const base = syncConfig.apiBaseUrl
    return `${base}/api/v1/todo-lists/${encodeURIComponent(listId)}/invites`
  },
  inviteUrl(inviteId: string): string {
    const base = syncConfig.apiBaseUrl
    return `${base}/api/v1/invites/${encodeURIComponent(inviteId)}`
  },
  redeemInviteUrl(): string {
    const base = syncConfig.apiBaseUrl
    return `${base}/api/v1/invites/redeem`
  },
}
