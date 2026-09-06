import { render, waitFor } from "@testing-library/react-native"
import { Redirect } from "expo-router"

import Index from "../index"
import { loadPendingInvite } from "@/api/auth/token-store"

jest.mock("@/api/auth/token-store", () => ({
  loadPendingInvite: jest.fn(),
}))
const mockLoadPendingInvite = loadPendingInvite as jest.Mock

jest.mock("expo-router", () => ({
  Redirect: jest.fn(() => null),
}))
const mockRedirect = Redirect as jest.Mock

function redirectedHref() {
  return mockRedirect.mock.calls[0]?.[0]?.href
}

describe("Index", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("redirects home when no invite is pending", async () => {
    mockLoadPendingInvite.mockResolvedValue(null)

    render(<Index />)

    await waitFor(() => expect(mockRedirect).toHaveBeenCalled())
    expect(redirectedHref()).toBe("/(home)")
  })

  it("resumes a pending invite instead, so a killed app doesn't lose it", async () => {
    mockLoadPendingInvite.mockResolvedValue("abc123")

    render(<Index />)

    await waitFor(() => expect(mockRedirect).toHaveBeenCalled())
    expect(redirectedHref()).toBe("/invite?token=abc123")
  })
})
