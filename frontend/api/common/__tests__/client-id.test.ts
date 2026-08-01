import { getClientId } from "../client-id"
import { getCurrentUserId } from "@/api/auth/auth-service"

jest.mock("@/api/auth/auth-service", () => ({
  getCurrentUserId: jest.fn(),
}))
jest.mock("expo-device", () => ({
  deviceName: "Pixel 9",
}))

const mockGetCurrentUserId = getCurrentUserId as jest.Mock

describe("client-id", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns the signed-in user's id when one is available", () => {
    mockGetCurrentUserId.mockReturnValue("keycloak-sub-123")

    expect(getClientId()).toBe("keycloak-sub-123")
  })

  it("falls back to the device name when nobody is signed in", () => {
    mockGetCurrentUserId.mockReturnValue(null)

    expect(getClientId()).toBe("Pixel 9")
  })

  it("reflects a change in signed-in user across calls, without any caching of its own", () => {
    mockGetCurrentUserId.mockReturnValue(null)
    expect(getClientId()).toBe("Pixel 9")

    mockGetCurrentUserId.mockReturnValue("keycloak-sub-123")
    expect(getClientId()).toBe("keycloak-sub-123")

    mockGetCurrentUserId.mockReturnValue(null)
    expect(getClientId()).toBe("Pixel 9")
  })
})
