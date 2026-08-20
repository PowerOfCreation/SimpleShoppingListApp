import {
  formatInviteCreatedAt,
  formatInviteExpiry,
  formatInviteTtl,
} from "../inviteFormatting"

const NOW = Date.parse("2026-08-20T12:00:00Z")
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe("formatInviteTtl", () => {
  it("labels every preset the backend accepts", () => {
    expect(formatInviteTtl("1h")).toBe("1 hour")
    expect(formatInviteTtl("24h")).toBe("24 hours")
    expect(formatInviteTtl("7d")).toBe("7 days")
    expect(formatInviteTtl("30d")).toBe("30 days")
  })
})

describe("formatInviteExpiry", () => {
  it("counts down in the largest unit that still fits", () => {
    expect(formatInviteExpiry(NOW + 30 * MINUTE, NOW)).toBe(
      "Expires in 30 minutes"
    )
    expect(formatInviteExpiry(NOW + 5 * HOUR, NOW)).toBe("Expires in 5 hours")
    expect(formatInviteExpiry(NOW + 7 * DAY, NOW)).toBe("Expires in 7 days")
  })

  it("uses the singular for exactly one unit", () => {
    expect(formatInviteExpiry(NOW + MINUTE, NOW)).toBe("Expires in 1 minute")
    expect(formatInviteExpiry(NOW + HOUR, NOW)).toBe("Expires in 1 hour")
    expect(formatInviteExpiry(NOW + DAY, NOW)).toBe("Expires in 1 day")
  })

  // Rounding down never overstates how long a link is still good for.
  it("rounds down rather than up", () => {
    expect(formatInviteExpiry(NOW + 47 * HOUR, NOW)).toBe("Expires in 1 day")
    expect(formatInviteExpiry(NOW + 119 * MINUTE, NOW)).toBe(
      "Expires in 1 hour"
    )
  })

  it("reports anything under a minute without a number", () => {
    expect(formatInviteExpiry(NOW + 30_000, NOW)).toBe(
      "Expires in less than a minute"
    )
  })

  it("reports a past or current expiry as expired", () => {
    expect(formatInviteExpiry(NOW, NOW)).toBe("Expired")
    expect(formatInviteExpiry(NOW - HOUR, NOW)).toBe("Expired")
  })

  it("says so when the server sent no readable expiry", () => {
    expect(formatInviteExpiry(null, NOW)).toBe("Expiry unknown")
  })
})

describe("formatInviteCreatedAt", () => {
  it("renders the creation date", () => {
    const created = Date.parse("2026-08-20T10:00:00Z")

    expect(formatInviteCreatedAt(created)).toBe(
      `Created ${new Date(created).toLocaleDateString()}`
    )
  })

  it("falls back to a placeholder without a date", () => {
    expect(formatInviteCreatedAt(null)).toBe("Created at an unknown time")
  })
})
