import { InviteTTL } from "@/api/sharing/sharing-client"

/** Human-readable label for a validity preset the backend accepts. */
export function formatInviteTtl(ttl: InviteTTL): string {
  switch (ttl) {
    case "1h":
      return "1 hour"
    case "24h":
      return "24 hours"
    case "7d":
      return "7 days"
    case "30d":
      return "30 days"
  }
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`
}

/**
 * How long an invite is still good for, relative to `now`.
 *
 * `now` is a parameter rather than a call to Date.now() so the same input
 * always renders the same string - the screen passes the timestamp it
 * rendered with, and a test doesn't have to freeze the clock.
 *
 * Rounds down, so an invite with 47 hours left reads "1 day": the exact
 * expiry is on the same row, and overstating remaining validity is the more
 * annoying of the two errors.
 */
export function formatInviteExpiry(
  expiresAt: number | null,
  now: number
): string {
  if (expiresAt === null) {
    return "Expiry unknown"
  }

  const remainingMs = expiresAt - now
  if (remainingMs <= 0) {
    return "Expired"
  }

  const minutes = Math.floor(remainingMs / 60_000)
  if (minutes < 1) {
    return "Expires in less than a minute"
  }
  if (minutes < 60) {
    return `Expires in ${plural(minutes, "minute")}`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `Expires in ${plural(hours, "hour")}`
  }

  return `Expires in ${plural(Math.floor(hours / 24), "day")}`
}

/** Absolute creation date, or a placeholder when the server sent none. */
export function formatInviteCreatedAt(createdAt: number | null): string {
  if (createdAt === null) {
    return "Created at an unknown time"
  }
  return `Created ${new Date(createdAt).toLocaleDateString()}`
}
