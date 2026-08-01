describe("sync config", () => {
  const originalEnv = process.env.EXPO_PUBLIC_API_URL

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalEnv
    jest.resetModules()
  })

  it("is configured when EXPO_PUBLIC_API_URL is set", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:8080"
    const { isSyncConfigured } = await freshModule()

    expect(isSyncConfigured()).toBe(true)
  })

  it("is not configured when EXPO_PUBLIC_API_URL is unset, degrading like login does", async () => {
    delete process.env.EXPO_PUBLIC_API_URL
    const { isSyncConfigured } = await freshModule()

    expect(isSyncConfigured()).toBe(false)
  })

  it("derives the events and sync-state URLs from the base URL", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:8080"
    const { syncConfig } = await freshModule()

    expect(syncConfig.eventsUrl).toBe("http://10.0.2.2:8080/api/v1/events")
    expect(syncConfig.syncStateUrl).toBe(
      "http://10.0.2.2:8080/api/v1/sync/state"
    )
  })

  it("derives a ws:// WebSocket URL from an http:// base URL", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:8080"
    const { syncConfig } = await freshModule()

    expect(syncConfig.webSocketUrl).toBe("ws://10.0.2.2:8080/api/v1/sync/ws")
  })

  it("derives a wss:// WebSocket URL from an https:// base URL", async () => {
    process.env.EXPO_PUBLIC_API_URL =
      "https://api.shopping-list.ops.light-dev-solutions.de"
    const { syncConfig } = await freshModule()

    expect(syncConfig.webSocketUrl).toBe(
      "wss://api.shopping-list.ops.light-dev-solutions.de/api/v1/sync/ws"
    )
  })

  function freshModule() {
    let mod!: typeof import("../config")
    jest.isolateModules(() => {
      mod = jest.requireActual<typeof import("../config")>("../config")
    })
    return mod
  }
})
