/**
 * Keycloak / OIDC configuration.
 *
 * Read from EXPO_PUBLIC_* env vars so the values can differ per build without
 * touching the app config. They are inlined into the bundle and are not secret:
 * the Keycloak client is a public client using PKCE and has no client secret.
 */
export const authConfig = {
  issuer: process.env.EXPO_PUBLIC_KEYCLOAK_ISSUER ?? "",
  clientId: process.env.EXPO_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
  /**
   * `offline_access` is what makes Keycloak hand out a long-lived refresh
   * token, so the session survives longer than the SSO session idle timeout.
   */
  scopes: ["openid", "profile", "email", "offline_access"],
} as const

/**
 * Login is optional — without configuration the account screen says so instead
 * of failing at the discovery request.
 */
export function isAuthConfigured(): boolean {
  return Boolean(authConfig.issuer && authConfig.clientId)
}
