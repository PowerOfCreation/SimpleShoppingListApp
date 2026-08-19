import * as Device from "expo-device"
import { getCurrentUserId } from "@/api/auth/auth-service"

// Only read once: it can't change at runtime, and expo-device's value is
// the same for the lifetime of the process either way.
const DEVICE_FALLBACK = Device.deviceName ?? "unknown-device"

/**
 * Identifies who/what produced a domain event. That is its only job: it
 * used to double as the backend's WebSocket ack routing key, but pushes
 * are confirmed by their own response now and the ?client_id= query param
 * is gone.
 *
 * There is deliberately no separately generated, persisted device id.
 * Sync only ever runs while signed in (SyncProvider gates on
 * status === "signedIn"), so by the time this value is used for anything
 * beyond local attribution, a Keycloak session already exists - reusing
 * that identity (the `sub` claim, via getCurrentUserId()) instead of
 * inventing a parallel one:
 * - needs no persistence at all (a previous version wrote a random UUID to
 *   app_preferences on first run; that's gone)
 * - is stable across a reinstall, so an event's attribution survives one
 *   (a locally generated id would not)
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
