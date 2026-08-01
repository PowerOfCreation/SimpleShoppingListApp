import {
  AuthRequest,
  TokenResponse,
  exchangeCodeAsync,
  fetchDiscoveryAsync,
  fetchUserInfoAsync,
  refreshAsync,
  revokeAsync,
} from "expo-auth-session"
import * as WebBrowser from "expo-web-browser"

import {
  AuthCancelledError,
  getValidAccessToken,
  login,
  logout,
  resetDiscoveryCache,
  restoreSession,
} from "../auth-service"
import { clearTokens, loadTokens, saveTokens } from "../token-store"

jest.mock("expo-auth-session")
jest.mock("expo-web-browser")
jest.mock("expo-application", () => ({
  applicationId: "de.example.sholist.dev",
}))
// Deliberately the *production* scheme: the redirect must follow the installed
// binary, not whatever environment the bundler was started in.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { scheme: ["sholist", "de.example.sholist"] },
  },
}))

const REDIRECT_URI = "de.example.sholist.dev://oauth2redirect"

const discovery = {
  authorizationEndpoint: "https://keycloak.test/auth",
  tokenEndpoint: "https://keycloak.test/token",
  userInfoEndpoint: "https://keycloak.test/userinfo",
  revocationEndpoint: "https://keycloak.test/revoke",
  endSessionEndpoint: "https://keycloak.test/logout",
}

const ActualTokenResponse =
  jest.requireActual<typeof import("expo-auth-session")>(
    "expo-auth-session"
  ).TokenResponse

function makeTokenResponse(overrides: Record<string, unknown> = {}) {
  return new ActualTokenResponse({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    idToken: "id-1",
    tokenType: "bearer",
    expiresIn: 300,
    issuedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  })
}

const mockedAuthRequest = AuthRequest as unknown as jest.Mock
const mockedFetchDiscovery = fetchDiscoveryAsync as jest.Mock
const mockedExchangeCode = exchangeCodeAsync as jest.Mock
const mockedFetchUserInfo = fetchUserInfoAsync as jest.Mock
const mockedRefresh = refreshAsync as jest.Mock
const mockedRevoke = revokeAsync as jest.Mock
const mockedOpenAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock

/** Latest AuthRequest instance created by the service under test. */
let promptAsync: jest.Mock

beforeEach(async () => {
  jest.clearAllMocks()
  resetDiscoveryCache()
  await clearTokens()

  // The mocked module replaces TokenResponse too, but the store needs the real
  // class to reconstruct sessions.
  ;(TokenResponse as unknown as jest.Mock).mockImplementation(
    (config: Record<string, unknown>) =>
      new ActualTokenResponse(config as never)
  )

  promptAsync = jest.fn().mockResolvedValue({
    type: "success",
    params: { code: "auth-code" },
  })

  mockedAuthRequest.mockImplementation(() => ({
    promptAsync,
    codeVerifier: "verifier-1",
  }))

  mockedFetchDiscovery.mockResolvedValue(discovery)
  mockedExchangeCode.mockResolvedValue(makeTokenResponse())
  mockedFetchUserInfo.mockResolvedValue({
    sub: "user-1",
    preferred_username: "niklas",
    name: "Niklas",
    email: "niklas@example.com",
  })
})

describe("login", () => {
  it("opens the browser with PKCE and stores the exchanged tokens", async () => {
    const result = await login()

    expect(result.success).toBe(true)
    expect(result.getValue()?.user).toEqual({
      subject: "user-1",
      username: "niklas",
      name: "Niklas",
      email: "niklas@example.com",
    })

    expect(mockedAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "test-client",
        redirectUri: REDIRECT_URI,
        usePKCE: true,
        scopes: expect.arrayContaining(["openid", "offline_access"]),
      })
    )
    expect(promptAsync).toHaveBeenCalledWith(discovery)
    expect(mockedExchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "auth-code",
        redirectUri: REDIRECT_URI,
        extraParams: { code_verifier: "verifier-1" },
      }),
      discovery
    )

    await expect(loadTokens()).resolves.toMatchObject({
      accessToken: "access-1",
    })
  })

  it("reports a cancelled browser session without storing anything", async () => {
    promptAsync.mockResolvedValue({ type: "cancel" })

    const result = await login()

    expect(result.success).toBe(false)
    expect(result.getError()).toBeInstanceOf(AuthCancelledError)
    expect(mockedExchangeCode).not.toHaveBeenCalled()
    await expect(loadTokens()).resolves.toBeNull()
  })

  it("fails when the provider returns an error", async () => {
    promptAsync.mockResolvedValue({
      type: "error",
      error: { message: "access_denied" },
      params: {},
    })

    const result = await login()

    expect(result.success).toBe(false)
    expect(result.getError()).not.toBeInstanceOf(AuthCancelledError)
    expect(result.getError().message).toContain("access_denied")
  })
})

describe("restoreSession", () => {
  it("returns null when nobody is signed in", async () => {
    const result = await restoreSession()

    expect(result.success).toBe(true)
    expect(result.getValue()).toBeNull()
  })

  it("refreshes an expired access token", async () => {
    await saveTokens(
      makeTokenResponse({
        accessToken: "old-access",
        issuedAt: Math.floor(Date.now() / 1000) - 3600,
        expiresIn: 300,
      })
    )
    mockedRefresh.mockResolvedValue(
      makeTokenResponse({ accessToken: "fresh-access" })
    )

    const result = await restoreSession()

    expect(mockedRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "refresh-1" }),
      discovery
    )
    expect(result.getValue()?.tokens.accessToken).toBe("fresh-access")
    await expect(loadTokens()).resolves.toMatchObject({
      accessToken: "fresh-access",
    })
  })

  it("keeps the previous refresh token when the provider does not rotate it", async () => {
    await saveTokens(
      makeTokenResponse({
        issuedAt: Math.floor(Date.now() / 1000) - 3600,
      })
    )
    mockedRefresh.mockResolvedValue(
      makeTokenResponse({
        accessToken: "fresh-access",
        refreshToken: undefined,
      })
    )

    await restoreSession()

    await expect(loadTokens()).resolves.toMatchObject({
      refreshToken: "refresh-1",
    })
  })

  it("does not refresh a token that is still fresh", async () => {
    await saveTokens(makeTokenResponse({ expiresIn: 3600 }))

    const result = await restoreSession()

    expect(mockedRefresh).not.toHaveBeenCalled()
    expect(result.getValue()?.tokens.accessToken).toBe("access-1")
  })
})

describe("getValidAccessToken", () => {
  it("returns null when signed out", async () => {
    const result = await getValidAccessToken()

    expect(result.getValue()).toBeNull()
  })

  it("returns the stored token while it is fresh", async () => {
    await saveTokens(makeTokenResponse({ expiresIn: 3600 }))

    const result = await getValidAccessToken()

    expect(result.getValue()).toBe("access-1")
    expect(mockedRefresh).not.toHaveBeenCalled()
  })
})

describe("logout", () => {
  beforeEach(async () => {
    await saveTokens(makeTokenResponse({ expiresIn: 3600 }))
    mockedRevoke.mockResolvedValue(true)
    mockedOpenAuthSession.mockResolvedValue({ type: "success" })
  })

  it("clears the tokens, revokes the refresh token and ends the SSO session", async () => {
    const result = await logout()

    expect(result.success).toBe(true)
    await expect(loadTokens()).resolves.toBeNull()
    expect(mockedRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ token: "refresh-1" }),
      discovery
    )

    const [url] = mockedOpenAuthSession.mock.calls[0]
    expect(url).toContain(discovery.endSessionEndpoint)
    expect(url).toContain("id_token_hint=id-1")
    expect(url).toContain(encodeURIComponent(REDIRECT_URI))
  })

  it("still signs out locally when revocation fails", async () => {
    mockedRevoke.mockRejectedValue(new Error("unsupported"))

    const result = await logout()

    expect(result.success).toBe(true)
    await expect(loadTokens()).resolves.toBeNull()
    expect(mockedOpenAuthSession).toHaveBeenCalled()
  })
})
