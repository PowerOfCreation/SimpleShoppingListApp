import { buildInviteLink, INVITE_PATH } from "../invite-link"
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
