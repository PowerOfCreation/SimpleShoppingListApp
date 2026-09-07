import { compareReleaseVersions } from "../release-version"

describe("release version ordering", () => {
  it.each([
    ["frontend-v1.2.0", "1.2.0", 0],
    ["frontend-v1.1.9", "1.2.0", -1],
    ["frontend-v1.10.0", "1.2.0", 1],
    ["frontend-v1.2.0-rc.2", "1.2.0", -1],
    ["frontend-v1.2.0", "1.2.0-rc.2", 1],
    ["frontend-v1.2.0-rc.10", "1.2.0-rc.2", 1],
    ["frontend-v1.2.0-rc.1", "1.2.0-rc.2", -1],
    ["frontend-v1.2.0", "Unknown", null],
  ])("compares %s with %s", (left, right, expected) => {
    expect(compareReleaseVersions(left, right)).toBe(expected)
  })
})
