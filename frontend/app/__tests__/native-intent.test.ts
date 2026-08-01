import { redirectSystemPath } from "../+native-intent"

jest.mock("expo-application", () => ({ applicationId: "de.example.app" }))

describe("redirectSystemPath", () => {
  it("keeps the router in place for the OIDC redirect", () => {
    expect(
      redirectSystemPath({
        path: "de.example.app://oauth2redirect?code=abc&state=xyz",
        initial: false,
      })
    ).toBeNull()
  })

  it("passes ordinary deep links through untouched", () => {
    expect(
      redirectSystemPath({ path: "/(home)/new_ingredient", initial: true })
    ).toBe("/(home)/new_ingredient")
  })
})
