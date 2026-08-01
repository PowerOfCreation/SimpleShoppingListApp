import * as SecureStore from "expo-secure-store"
import { TokenResponse } from "expo-auth-session"

import { clearTokens, loadTokens, saveTokens } from "../token-store"

function makeTokens(overrides: Partial<TokenResponse> = {}) {
  return new TokenResponse({
    accessToken: "access-123",
    refreshToken: "refresh-123",
    idToken: "id-123",
    tokenType: "bearer",
    expiresIn: 300,
    issuedAt: 1_700_000_000,
    ...overrides,
  })
}

describe("token-store", () => {
  beforeEach(async () => {
    await clearTokens()
    jest.clearAllMocks()
  })

  it("round-trips a stored session", async () => {
    await saveTokens(makeTokens())

    const loaded = await loadTokens()

    expect(loaded).not.toBeNull()
    expect(loaded!.accessToken).toBe("access-123")
    expect(loaded!.refreshToken).toBe("refresh-123")
    expect(loaded!.idToken).toBe("id-123")
    expect(loaded!.expiresIn).toBe(300)
    expect(loaded!.issuedAt).toBe(1_700_000_000)
  })

  it("stores every token under its own key so no single value gets too large", async () => {
    await saveTokens(makeTokens())

    const keys = (SecureStore.setItemAsync as jest.Mock).mock.calls.map(
      (call) => call[0]
    )

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(
      expect.arrayContaining([
        "sholist.auth.accessToken",
        "sholist.auth.refreshToken",
        "sholist.auth.idToken",
        "sholist.auth.meta",
      ])
    )
  })

  it("returns null when nothing is stored", async () => {
    await expect(loadTokens()).resolves.toBeNull()
  })

  it("removes keys that the new session does not have", async () => {
    await saveTokens(makeTokens())
    await saveTokens(makeTokens({ refreshToken: undefined }))

    const loaded = await loadTokens()

    expect(loaded!.refreshToken).toBeUndefined()
  })

  it("keeps the tokens usable when the metadata is unreadable", async () => {
    await saveTokens(makeTokens())
    await SecureStore.setItemAsync("sholist.auth.meta", "not-json")

    const loaded = await loadTokens()

    expect(loaded!.accessToken).toBe("access-123")
    expect(loaded!.refreshToken).toBe("refresh-123")
    expect(loaded!.expiresIn).toBeUndefined()
  })

  it("clears every key on logout", async () => {
    await saveTokens(makeTokens())

    await clearTokens()

    await expect(loadTokens()).resolves.toBeNull()
  })
})
