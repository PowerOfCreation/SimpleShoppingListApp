/**
 * Backend base URL for list sync.
 *
 * Read from EXPO_PUBLIC_API_URL, which is inlined into the JS bundle at
 * build time from .env.development / .env.production (see the frontend
 * README's "Backend / sync" section for why - in short: this needs to be
 * decided at bundle time, not at whatever moment app.config.js happens to
 * be evaluated, or a release build can end up silently pointed at a dev
 * backend).
 */
function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? ""
}

/**
 * Sync is optional, mirroring how Keycloak login degrades without its env
 * vars (api/auth/config.ts's isAuthConfigured()): without a configured
 * backend URL, the app works exactly as it did before sync existed - it
 * just never sends anything.
 */
export function isSyncConfigured(): boolean {
  return Boolean(getApiBaseUrl())
}

function toWebSocketUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) {
    return "wss://" + httpUrl.slice("https://".length)
  }
  if (httpUrl.startsWith("http://")) {
    return "ws://" + httpUrl.slice("http://".length)
  }
  return httpUrl
}

export const syncConfig = {
  get apiBaseUrl(): string {
    return getApiBaseUrl()
  },
  get eventsUrl(): string {
    return `${getApiBaseUrl()}/api/v1/events`
  },
  get syncStateUrl(): string {
    return `${getApiBaseUrl()}/api/v1/sync/state`
  },
  get syncHeadUrl(): string {
    return `${getApiBaseUrl()}/api/v1/sync/head`
  },
  get syncEventsUrl(): string {
    return `${getApiBaseUrl()}/api/v1/sync/events`
  },
  get webSocketUrl(): string {
    return `${toWebSocketUrl(getApiBaseUrl())}/api/v1/sync/ws`
  },
}
