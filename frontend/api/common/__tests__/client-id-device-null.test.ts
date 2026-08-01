import { getClientId } from "../client-id"

jest.mock("expo-device", () => ({ deviceName: null }))
jest.mock("@/api/auth/auth-service", () => ({
  getCurrentUserId: jest.fn(() => null),
}))

describe("client-id device fallback", () => {
  it("falls back to a fixed string when the device reports no name", () => {
    expect(getClientId()).toBe("unknown-device")
  })
})
