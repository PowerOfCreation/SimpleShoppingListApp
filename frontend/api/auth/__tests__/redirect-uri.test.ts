import * as Application from "expo-application"
import Constants from "expo-constants"

import { getRedirectScheme, getRedirectUri } from "../redirect-uri"

jest.mock("expo-application", () => ({ applicationId: null }))
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { scheme: undefined } },
}))

const mockedApplication = Application as { applicationId: string | null }
const mockedConstants = Constants as unknown as {
  expoConfig: { scheme?: string | string[] } | null
}

describe("redirect-uri", () => {
  it("follows the installed binary even when the bundler reports another variant", () => {
    // The dev build is installed, but Metro was started without
    // APP_VARIANT=development, so expoConfig carries the production scheme.
    // Using that would redirect to an app that is not installed and the login
    // would hang in the browser.
    mockedApplication.applicationId = "de.lightdevsolutions.sholist.dev"
    mockedConstants.expoConfig = { scheme: "de.lightdevsolutions.sholist" }

    expect(getRedirectUri()).toBe(
      "de.lightdevsolutions.sholist.dev://oauth2redirect"
    )
  })

  it("uses the production application id in a production build", () => {
    mockedApplication.applicationId = "de.lightdevsolutions.sholist"
    mockedConstants.expoConfig = { scheme: "de.lightdevsolutions.sholist" }

    expect(getRedirectUri()).toBe(
      "de.lightdevsolutions.sholist://oauth2redirect"
    )
  })

  it("falls back to the declared reverse-DNS scheme without an application id", () => {
    mockedApplication.applicationId = null
    mockedConstants.expoConfig = { scheme: "de.lightdevsolutions.sholist.dev" }

    expect(getRedirectScheme()).toBe("de.lightdevsolutions.sholist.dev")
  })

  it("still finds the reverse-DNS entry when several schemes are declared", () => {
    mockedApplication.applicationId = null
    mockedConstants.expoConfig = {
      scheme: ["sholist-dev", "de.lightdevsolutions.sholist.dev"],
    }

    expect(getRedirectScheme()).toBe("de.lightdevsolutions.sholist.dev")
  })

  it("returns null when no reverse-DNS scheme is available at all", () => {
    mockedApplication.applicationId = null
    mockedConstants.expoConfig = { scheme: "sholist" }

    expect(getRedirectUri()).toBeNull()
  })
})
