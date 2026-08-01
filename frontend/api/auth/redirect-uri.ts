import * as Application from "expo-application"
import Constants from "expo-constants"

export const REDIRECT_PATH = "oauth2redirect"

/**
 * RFC 8252 recommends a redirect scheme based on a domain name the app
 * controls, so we use the reverse-DNS scheme declared in app.config.js.
 *
 * The scheme is read from the native application id rather than from
 * `Constants.expoConfig`: the latter reflects the environment the *bundler* was
 * started in, which can disagree with the installed binary (running Metro
 * without APP_VARIANT=development against a dev build yields the production
 * scheme, and the redirect then points at an app that is not installed).
 * `Application.applicationId` always comes from the running binary, and
 * app.config.js derives the bundle id and the scheme from the same constant.
 */
export function getRedirectScheme(): string | null {
  if (Application.applicationId) {
    return Application.applicationId
  }

  // Web has no application id; fall back to the declared config.
  const scheme = Constants.expoConfig?.scheme
  const schemes = Array.isArray(scheme) ? scheme : scheme ? [scheme] : []
  return schemes.find((entry) => entry.includes(".")) ?? null
}

/**
 * The exact string returned here must be registered in Keycloak under
 * "Valid redirect URIs", otherwise the login fails with
 * "Invalid parameter: redirect_uri".
 */
export function getRedirectUri(): string | null {
  const scheme = getRedirectScheme()
  return scheme ? `${scheme}://${REDIRECT_PATH}` : null
}
