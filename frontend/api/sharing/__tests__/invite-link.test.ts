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

  it("builds a verified https App Link when a native scheme is available", () => {
    mockGetRedirectScheme.mockReturnValue("de.lightdevsolutions.sholist.dev")

    expect(buildInviteLink("token-1")).toBe(
      `https://static.ops.light-dev-solutions.de/${INVITE_PATH}?token=token-1`
    )
  })

  // The scheme is only a gate on "is this a native build" - the App Link
  // itself is the same regardless of which build reports it.
  it("builds the same App Link regardless of which build's scheme is reported", () => {
    mockGetRedirectScheme.mockReturnValue("de.lightdevsolutions.sholist")

    expect(buildInviteLink("token-1")).toBe(
      `https://static.ops.light-dev-solutions.de/${INVITE_PATH}?token=token-1`
    )
  })

  it("escapes tokens containing url-unsafe characters", () => {
    mockGetRedirectScheme.mockReturnValue("app.test")

    expect(buildInviteLink("a+b/c=")).toBe(
      `https://static.ops.light-dev-solutions.de/${INVITE_PATH}?token=a%2Bb%2Fc%3D`
    )
  })

  it("returns null when no scheme is available", () => {
    mockGetRedirectScheme.mockReturnValue(null)

    expect(buildInviteLink("token-1")).toBeNull()
  })
})
