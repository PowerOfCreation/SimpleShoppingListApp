import {
  buildInviteLink,
  extractInviteToken,
  INVITE_PATH,
} from "../invite-link"
import { getRedirectScheme } from "@/api/auth/redirect-uri"

jest.mock("@/api/auth/redirect-uri", () => ({
  getRedirectScheme: jest.fn(),
}))
const mockGetRedirectScheme = getRedirectScheme as jest.Mock

describe("buildInviteLink", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("builds a deep link from the app's own scheme", () => {
    mockGetRedirectScheme.mockReturnValue("de.lightdevsolutions.sholist.dev")

    expect(buildInviteLink("token-1")).toBe(
      `de.lightdevsolutions.sholist.dev://${INVITE_PATH}?token=token-1`
    )
  })

  // The scheme comes from the running binary, so a dev build never hands out
  // a link that would open the production app.
  it("uses whatever scheme the running build reports", () => {
    mockGetRedirectScheme.mockReturnValue("de.lightdevsolutions.sholist")

    expect(buildInviteLink("token-1")).toContain(
      "de.lightdevsolutions.sholist://"
    )
  })

  it("escapes tokens containing url-unsafe characters", () => {
    mockGetRedirectScheme.mockReturnValue("app.test")

    expect(buildInviteLink("a+b/c=")).toBe(
      `app.test://${INVITE_PATH}?token=a%2Bb%2Fc%3D`
    )
  })

  it("returns null when no scheme is available", () => {
    mockGetRedirectScheme.mockReturnValue(null)

    expect(buildInviteLink("token-1")).toBeNull()
  })
})

describe("extractInviteToken", () => {
  it("pulls the token out of a full invite link", () => {
    expect(
      extractInviteToken(
        `de.lightdevsolutions.sholist.dev://${INVITE_PATH}?token=abc123`
      )
    ).toBe("abc123")
  })

  it("decodes a url-escaped token", () => {
    expect(
      extractInviteToken(`app.test://${INVITE_PATH}?token=a%2Bb%2Fc%3D`)
    ).toBe("a+b/c=")
  })

  it("stops at the next query param", () => {
    expect(
      extractInviteToken(`app.test://${INVITE_PATH}?token=abc123&other=xyz`)
    ).toBe("abc123")
  })

  it("treats input without a token param as a raw token", () => {
    expect(extractInviteToken("abc123")).toBe("abc123")
  })

  it("trims surrounding whitespace", () => {
    expect(extractInviteToken("  abc123  ")).toBe("abc123")
  })

  it("returns null for empty input", () => {
    expect(extractInviteToken("   ")).toBeNull()
  })
})
