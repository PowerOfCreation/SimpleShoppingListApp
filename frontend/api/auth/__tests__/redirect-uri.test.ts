import * as Application from "expo-application"
import { makeRedirectUri } from "expo-auth-session"
import { Platform } from "react-native"

import { getRedirectScheme, getRedirectUri } from "../redirect-uri"

jest.mock("expo-application", () => ({ applicationId: null }))
jest.mock("expo-auth-session", () => ({
  makeRedirectUri: jest.fn(),
}))

const mockedApplication = Application as { applicationId: string | null }
const mockedMakeRedirectUri = makeRedirectUri as jest.Mock

describe("redirect-uri", () => {
  afterEach(() => {
    Platform.OS = "ios"
    jest.clearAllMocks()
  })

  it("follows the installed binary even when the bundler reports another variant", () => {
    // The dev build is installed, but Metro was started without
    // APP_VARIANT=development, so expoConfig carries the production scheme.
    // Using that would redirect to an app that is not installed and the login
    // would hang in the browser.
    mockedApplication.applicationId = "de.lightdevsolutions.sholist.dev"

    expect(getRedirectUri()).toBe(
      "de.lightdevsolutions.sholist.dev://oauth2redirect"
    )
  })

  it("uses the production application id in a production build", () => {
    mockedApplication.applicationId = "de.lightdevsolutions.sholist"

    expect(getRedirectUri()).toBe(
      "de.lightdevsolutions.sholist://oauth2redirect"
    )
  })

  it("returns null without an application id on native", () => {
    mockedApplication.applicationId = null

    expect(getRedirectScheme()).toBeNull()
    expect(getRedirectUri()).toBeNull()
  })

  it("uses the page's own origin on web, not the reverse-DNS scheme", () => {
    Platform.OS = "web"
    mockedApplication.applicationId = null
    mockedMakeRedirectUri.mockReturnValue(
      "http://localhost:8081/oauth2redirect"
    )

    expect(getRedirectUri()).toBe("http://localhost:8081/oauth2redirect")
    expect(mockedMakeRedirectUri).toHaveBeenCalledWith({
      path: "oauth2redirect",
    })
  })
})
