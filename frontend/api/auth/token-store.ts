import * as SecureStore from "expo-secure-store"
import { TokenResponse } from "expo-auth-session"

import { createLogger } from "@/api/common/logger"

const logger = createLogger("TokenStore")

/**
 * Each token gets its own key. Keycloak's JWTs are easily above the ~2 KB that
 * some iOS releases refuse for a single SecureStore value, so storing all of
 * them in one JSON blob would risk hitting that limit.
 */
const KEYS = {
  accessToken: "sholist.auth.accessToken",
  refreshToken: "sholist.auth.refreshToken",
  idToken: "sholist.auth.idToken",
  /** JSON with the fields TokenResponse needs to compute freshness. */
  meta: "sholist.auth.meta",
} as const

/**
 * Survives the invite screen across the sign-in browser round-trip: if the OS
 * kills the app while Keycloak's login page is open, a cold start can still
 * find its way back to the invite instead of silently dropping it.
 */
const PENDING_INVITE_KEY = "sholist.invite.pendingToken"

type StoredMeta = {
  tokenType?: string
  expiresIn?: number
  issuedAt: number
  scope?: string
}

async function setOrDelete(key: string, value: string | undefined) {
  if (value) {
    await SecureStore.setItemAsync(key, value)
  } else {
    await SecureStore.deleteItemAsync(key)
  }
}

export async function saveTokens(tokens: TokenResponse): Promise<void> {
  const meta: StoredMeta = {
    tokenType: tokens.tokenType,
    expiresIn: tokens.expiresIn,
    issuedAt: tokens.issuedAt,
    scope: tokens.scope,
  }

  await Promise.all([
    setOrDelete(KEYS.accessToken, tokens.accessToken),
    setOrDelete(KEYS.refreshToken, tokens.refreshToken),
    setOrDelete(KEYS.idToken, tokens.idToken),
    setOrDelete(KEYS.meta, JSON.stringify(meta)),
  ])
}

export async function loadTokens(): Promise<TokenResponse | null> {
  const [accessToken, refreshToken, idToken, rawMeta] = await Promise.all([
    SecureStore.getItemAsync(KEYS.accessToken),
    SecureStore.getItemAsync(KEYS.refreshToken),
    SecureStore.getItemAsync(KEYS.idToken),
    SecureStore.getItemAsync(KEYS.meta),
  ])

  if (!accessToken) {
    return null
  }

  let meta: Partial<StoredMeta> = {}
  if (rawMeta) {
    try {
      meta = JSON.parse(rawMeta)
    } catch (err) {
      // Treat unreadable metadata as "expiry unknown" rather than discarding a
      // usable refresh token.
      logger.warn("Ignoring unreadable token metadata", err)
    }
  }

  return new TokenResponse({
    accessToken,
    refreshToken: refreshToken ?? undefined,
    idToken: idToken ?? undefined,
    tokenType: meta.tokenType as TokenResponse["tokenType"],
    expiresIn: meta.expiresIn,
    issuedAt: meta.issuedAt,
    scope: meta.scope,
  })
}

export async function clearTokens(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key))
  )
}

export async function savePendingInvite(token: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_INVITE_KEY, token)
}

export async function loadPendingInvite(): Promise<string | null> {
  return SecureStore.getItemAsync(PENDING_INVITE_KEY)
}

export async function clearPendingInvite(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_INVITE_KEY)
}
