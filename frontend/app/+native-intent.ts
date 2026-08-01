import { REDIRECT_PATH } from "@/api/auth/redirect-uri"

/**
 * The OIDC redirect (`<bundle-id>://oauth2redirect?code=...`) is a deep link
 * meant for the pending auth session in expo-web-browser, not a screen. Without
 * this hook expo-router additionally tries to navigate to it and lands on its
 * "Unmatched Route" page on top of the app.
 *
 * Returning a falsy value tells the router to stay where it is.
 */
export function redirectSystemPath({
  path,
}: {
  path: string
  initial: boolean
}): string | null {
  try {
    if (path.includes(REDIRECT_PATH)) {
      return null
    }
  } catch {
    // Never let link handling crash the app.
    return path
  }

  return path
}
