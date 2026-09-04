import { getRedirectScheme } from "@/api/auth/redirect-uri"

/**
 * The deep-link path an invite points at. Redeeming is not implemented yet -
 * nothing in the app navigates here (see the note in
 * frontend/docs/sync-sharing-target.md §5) - but the link the owner shares
 * has to be built now, and its shape is what a future redeem handler will
 * have to match.
 */
export const INVITE_PATH = "invite"

/** Query parameter carrying the plaintext invite token. */
export const INVITE_TOKEN_PARAM = "token"

/**
 * The verified Android App Link host serving assetlinks.json
 * (see docs/.well-known/ and android.intentFilters in app.config.js).
 */
const APP_LINK_ORIGIN = "https://static.ops.light-dev-solutions.de"

/**
 * Builds the shareable link for a freshly created invite token.
 *
 * The link is assembled here rather than returned by the backend on purpose:
 * the server never learns a frontend route (sync-sharing-target.md §4.3), so
 * the app owns the mapping from token to URL. It's a verified https App Link
 * rather than the app's custom scheme so tapping it opens the app directly
 * instead of requiring a manual paste.
 *
 * Returns null when the platform has no native application id (web).
 * Callers must handle that rather than shipping a link that opens nothing.
 */
export function buildInviteLink(token: string): string | null {
  const scheme = getRedirectScheme()
  if (!scheme) {
    return null
  }
  const encodedToken = encodeURIComponent(token)
  return `${APP_LINK_ORIGIN}/${INVITE_PATH}?${INVITE_TOKEN_PARAM}=${encodedToken}`
}
