import type { DiscoveryDocument } from "expo-auth-session"
import {
  AuthRequest,
  TokenResponse,
  exchangeCodeAsync,
  fetchDiscoveryAsync,
  fetchUserInfoAsync,
  refreshAsync,
  revokeAsync,
  TokenTypeHint,
} from "expo-auth-session"
import * as WebBrowser from "expo-web-browser"

import { AuthError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { createLogger } from "@/api/common/logger"
import { authConfig, isAuthConfigured } from "./config"
import { getRedirectUri } from "./redirect-uri"
import { clearTokens, loadTokens, saveTokens } from "./token-store"

const logger = createLogger("AuthService")

export type AuthUser = {
  subject: string
  username?: string
  name?: string
  email?: string
}

export type AuthSession = {
  user: AuthUser
  tokens: TokenResponse
}

/** Cancelled by the user rather than failed — the UI stays silent for this. */
export class AuthCancelledError extends AuthError {
  constructor() {
    super("Login was cancelled")
  }
}

let discoveryPromise: Promise<DiscoveryDocument> | null = null

// Synchronous cache of the signed-in user's subject, kept in sync with
// login/restoreSession/logout below. This exists so plain (non-React)
// modules - client-id.ts, called synchronously from shopping-list-service
// and ingredient-service - can know "who is signed in right now" without
// going through useAuth(), which only works inside components.
let currentUserId: string | null = null

/**
 * The signed-in user's Keycloak subject, or null if nobody is signed in
 * (or a session hasn't been restored yet). See client-id.ts for why this
 * doubles as the identity used for WebSocket ack routing once sync is
 * active - sync only ever runs while signed in, so there is always a
 * subject available by the time it would matter.
 */
export function getCurrentUserId(): string | null {
  return currentUserId
}

/** Test seam - resets the cached signed-in user between tests. */
export function resetCurrentUserCache(): void {
  currentUserId = null
}

/**
 * The discovery document does not change between logins, so it is fetched once
 * per app run. A failed fetch is not cached, otherwise a single offline moment
 * would break login until restart.
 */
async function getDiscovery(): Promise<DiscoveryDocument> {
  if (!discoveryPromise) {
    discoveryPromise = fetchDiscoveryAsync(authConfig.issuer).catch((err) => {
      discoveryPromise = null
      throw err
    })
  }
  return discoveryPromise
}

/** Test seam — resets the memoized discovery document. */
export function resetDiscoveryCache(): void {
  discoveryPromise = null
}

function requireSetup(): { redirectUri: string } {
  if (!isAuthConfigured()) {
    throw new AuthError(
      "Keycloak is not configured (EXPO_PUBLIC_KEYCLOAK_ISSUER / EXPO_PUBLIC_KEYCLOAK_CLIENT_ID)"
    )
  }

  const redirectUri = getRedirectUri()
  if (!redirectUri) {
    throw new AuthError("No reverse-DNS scheme declared in the app config")
  }

  return { redirectUri }
}

async function toUser(tokens: TokenResponse): Promise<AuthUser> {
  const discovery = await getDiscovery()

  if (!discovery.userInfoEndpoint) {
    throw new AuthError("Provider exposes no userinfo endpoint")
  }

  const info = await fetchUserInfoAsync(
    { accessToken: tokens.accessToken },
    discovery
  )

  return {
    subject: String(info.sub),
    username: info.preferred_username,
    name: info.name,
    email: info.email,
  }
}

/**
 * Opens the Keycloak login page in the system browser (Chrome Custom Tabs /
 * ASWebAuthenticationSession) and exchanges the returned code for tokens.
 * An embedded WebView is deliberately not used — see RFC 8252.
 */
export async function login(): Promise<Result<AuthSession, AuthError>> {
  return Result.fromPromise(
    (async () => {
      const { redirectUri } = requireSetup()
      const discovery = await getDiscovery()

      const request = new AuthRequest({
        clientId: authConfig.clientId,
        redirectUri,
        scopes: [...authConfig.scopes],
        usePKCE: true,
      })

      const result = await request.promptAsync(discovery)

      if (result.type !== "success") {
        if (result.type === "error") {
          throw new AuthError(
            result.error?.message ?? "Authorization request failed"
          )
        }
        throw new AuthCancelledError()
      }

      const tokens = await exchangeCodeAsync(
        {
          clientId: authConfig.clientId,
          code: result.params.code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier ?? "" },
        },
        discovery
      )

      await saveTokens(tokens)
      const user = await toUser(tokens)
      currentUserId = user.subject

      logger.info("Login succeeded")
      return { user, tokens }
    })(),
    (err) => toAuthError(err, "Login failed")
  )
}

/**
 * Restores a session from secure storage on app start, refreshing the access
 * token when it has expired. Returns `null` when nobody is logged in.
 */
export async function restoreSession(): Promise<
  Result<AuthSession | null, AuthError>
> {
  return Result.fromPromise(
    (async () => {
      if (!isAuthConfigured()) {
        return null
      }

      const stored = await loadTokens()
      if (!stored) {
        return null
      }

      const tokens = stored.shouldRefresh()
        ? await refreshTokens(stored)
        : stored

      const user = await toUser(tokens)
      currentUserId = user.subject
      return { user, tokens }
    })(),
    (err) => toAuthError(err, "Could not restore session")
  )
}

async function refreshTokens(stored: TokenResponse): Promise<TokenResponse> {
  if (!stored.refreshToken) {
    throw new AuthError("Access token expired and no refresh token is stored")
  }

  const discovery = await getDiscovery()
  const refreshed = await refreshAsync(
    {
      clientId: authConfig.clientId,
      refreshToken: stored.refreshToken,
      scopes: [...authConfig.scopes],
    },
    discovery
  )

  // Keycloak rotates refresh tokens, but only returns a new one when rotation
  // is enabled — keep the old one otherwise.
  if (!refreshed.refreshToken) {
    refreshed.refreshToken = stored.refreshToken
  }

  await saveTokens(refreshed)
  return refreshed
}

/**
 * Returns an access token that is valid right now, refreshing it if needed.
 * This is the entry point for a future API client.
 */
export async function getValidAccessToken(): Promise<
  Result<string | null, AuthError>
> {
  return Result.fromPromise(
    (async () => {
      const stored = await loadTokens()
      if (!stored) {
        return null
      }
      const tokens = stored.shouldRefresh()
        ? await refreshTokens(stored)
        : stored
      return tokens.accessToken
    })(),
    (err) => toAuthError(err, "Could not provide an access token")
  )
}

/**
 * Clears the local tokens, revokes the refresh token and ends the Keycloak SSO
 * session. Without the last step the browser cookie would silently sign the
 * user straight back in on the next login attempt.
 */
export async function logout(): Promise<Result<void, AuthError>> {
  return Result.fromPromise(
    (async () => {
      const stored = await loadTokens()
      await clearTokens()
      currentUserId = null

      if (!stored || !isAuthConfigured()) {
        return
      }

      const discovery = await getDiscovery()

      if (stored.refreshToken && discovery.revocationEndpoint) {
        try {
          await revokeAsync(
            {
              clientId: authConfig.clientId,
              token: stored.refreshToken,
              tokenTypeHint: TokenTypeHint.RefreshToken,
            },
            discovery
          )
        } catch (err) {
          // Revocation is best effort; the tokens are already gone locally.
          logger.warn("Token revocation failed", err)
        }
      }

      if (discovery.endSessionEndpoint && stored.idToken) {
        const redirectUri = getRedirectUri()
        const params = new URLSearchParams({ id_token_hint: stored.idToken })
        if (redirectUri) {
          params.append("post_logout_redirect_uri", redirectUri)
        }

        try {
          await WebBrowser.openAuthSessionAsync(
            `${discovery.endSessionEndpoint}?${params.toString()}`,
            redirectUri
          )
        } catch (err) {
          logger.warn("Ending the SSO session failed", err)
        }
      }

      logger.info("Logout completed")
    })(),
    (err) => toAuthError(err, "Logout failed")
  )
}

function toAuthError(err: unknown, fallbackMessage: string): AuthError {
  if (err instanceof AuthError) {
    return err
  }
  const message = err instanceof Error ? err.message : String(err)
  return new AuthError(`${fallbackMessage}: ${message}`, err)
}
