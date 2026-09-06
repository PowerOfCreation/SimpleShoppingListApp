import * as Application from "expo-application"
import { makeRedirectUri } from "expo-auth-session"
import { Platform } from "react-native"

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
 *
 * Null on web: there is no installed app for a custom scheme to reopen.
 */
export function getRedirectScheme(): string | null {
  return Application.applicationId
}

/**
 * The exact string returned here must be registered in Keycloak under
 * "Valid redirect URIs", otherwise the login fails with
 * "Invalid parameter: redirect_uri".
 *
 * On web there is no app for a custom scheme to reopen - Keycloak has to
 * land the browser back on a page this same origin serves. `makeRedirectUri`
 * builds that from `window.location.origin`, which is what
 * `WebBrowser.maybeCompleteAuthSession()` (see AuthProvider.tsx) watches for
 * to close the login popup.
 */
export function getRedirectUri(): string | null {
  if (Platform.OS === "web") {
    return makeRedirectUri({ path: REDIRECT_PATH })
  }

  const scheme = getRedirectScheme()
  return scheme ? `${scheme}://${REDIRECT_PATH}` : null
}
