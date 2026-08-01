import * as Device from "expo-device"
import { getCurrentUserId } from "@/api/auth/auth-service"

// Only read once: it can't change at runtime, and expo-device's value is
// the same for the lifetime of the process either way.
const DEVICE_FALLBACK = Device.deviceName ?? "unknown-device"

/**
 * Identifies who/what produced a domain event, and - once signed in - is
 * also the key the backend uses to route WebSocket acks (see
 * SyncSocket.connect, which sends this as the ?client_id= query param).
 *
 * There is deliberately no separately generated, persisted device id.
 * Sync only ever runs while signed in (SyncProvider gates on
 * status === "signedIn"), so by the time this value is used for anything
 * beyond local attribution, a Keycloak session already exists - reusing
 * that identity (the `sub` claim, via getCurrentUserId()) instead of
 * inventing a parallel one:
 * - needs no persistence at all (a previous version wrote a random UUID to
 *   app_preferences on first run; that's gone)
 * - lets multiple devices of the same account share one WebSocket routing
 *   key, which is harmless (an ack for an event a given device doesn't
 *   have in its own outbox is a no-op - see outbox-repository.ts's
 *   markSynced) and is what a future "notify my other devices" feature
 *   would want anyway
 * - is a real identity rather than a self-declared string nobody checks
 *
 * Signed out (or before a session has been restored yet), this falls back
 * to the device name, purely for readability in the local event log -
 * nothing else consumes it in the signed-out case, since sync/WS never
 * runs without a session.
 */
export function getClientId(): string {
  return getCurrentUserId() ?? DEVICE_FALLBACK
}
