import { getRedirectScheme } from "@/api/auth/redirect-uri"

/**
 * The deep-link path an invite points at. Nothing in the app auto-opens on
 * this path yet: the link uses the app's custom scheme, which isn't
 * domain-verified, so any tap-to-open handling here would trust whichever
 * app the OS resolves the scheme to - see redeem_invite.tsx and
 * TODO_UNIVERSAL_LINKS_PROMPT.md. Redeeming instead goes through a manual
 * paste entry point (`extractInviteToken` below) until real https
 * Universal/App Links exist.
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

/**
 * Pulls a redeemable token out of whatever a person pasted: a full invite
 * link, or the raw token by itself. `URL` can choke on a custom-scheme
 * value depending on the runtime, so the query string is parsed by hand
 * instead of relying on it - this only ever runs on manually pasted text
 * (see redeem_invite.tsx), never on an incoming system deep link.
 */
export function extractInviteToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  const marker = `${INVITE_TOKEN_PARAM}=`
  const markerIndex = trimmed.indexOf(marker)
  if (markerIndex === -1) {
    // No query param found - treat the whole input as a raw token.
    return trimmed
  }
  const afterMarker = trimmed.slice(markerIndex + marker.length)
  const nextParam = afterMarker.indexOf("&")
  const rawToken =
    nextParam === -1 ? afterMarker : afterMarker.slice(0, nextParam)
  try {
    return decodeURIComponent(rawToken)
  } catch {
    return rawToken
  }
}
