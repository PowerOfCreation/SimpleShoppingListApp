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
 * Builds the shareable link for a freshly created invite token.
 *
 * The link is assembled here rather than returned by the backend on purpose:
 * the server never learns a frontend route (sync-sharing-target.md §4.3), so
 * the app owns the mapping from token to URL. The scheme is the app's
 * reverse-DNS scheme, the same one the OIDC redirect uses - which means a dev
 * build produces a dev link and a release build a release one, without either
 * having to know about the other.
 *
 * Returns null when the scheme can't be determined (web, where there is no
 * application id). Callers must handle that rather than shipping a link that
 * opens nothing.
 */
export function buildInviteLink(token: string): string | null {
  const scheme = getRedirectScheme()
  if (!scheme) {
    return null
  }
  const encodedToken = encodeURIComponent(token)
  return `${scheme}://${INVITE_PATH}?${INVITE_TOKEN_PARAM}=${encodedToken}`
}
