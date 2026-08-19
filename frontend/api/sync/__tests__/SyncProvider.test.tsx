import React from "react"
import { render, waitFor } from "@testing-library/react-native"
import { Text, AppState } from "react-native"

import { SyncProvider } from "../SyncProvider"
import { useAuth } from "@/api/auth/AuthProvider"
import { SyncEngine } from "@/api/sync/sync-engine"
import { SyncSocket } from "@/api/sync/sync-socket"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { Result } from "@/api/common/result"
import { notifyOutboxChanged } from "@/api/sync/outbox-events"
import * as syncConfigModule from "@/api/sync/config"
import { flushMicrotasks } from "../test-helpers"

jest.mock("@/api/auth/AuthProvider")
jest.mock("@/api/sync/sync-engine")
jest.mock("@/api/sync/sync-socket")
jest.mock("@/database/database", () => ({
  getDatabase: jest.fn(() => ({})),
}))
jest.mock("@/database/outbox-repository")
jest.mock("@/database/event-repository")
jest.mock("@/database/list-sync-settings-repository")
jest.mock("@/api/sync/sync-client")

const mockedUseAuth = useAuth as jest.Mock
const MockSyncEngine = SyncEngine as jest.MockedClass<typeof SyncEngine>
const MockSyncSocket = SyncSocket as jest.MockedClass<typeof SyncSocket>
const MockListSyncSettingsRepository =
  ListSyncSettingsRepository as jest.MockedClass<
    typeof ListSyncSettingsRepository
  >

function mockAuth(status: "loading" | "signedOut" | "signedIn") {
  mockedUseAuth.mockReturnValue({
    status,
    user: null,
    error: null,
    busy: false,
    login: jest.fn(),
    logout: jest.fn(),
  })
}

describe("SyncProvider", () => {
  let flushMock: jest.Mock
  let reconcileMock: jest.Mock
  let pullMock: jest.Mock
  let pullListMock: jest.Mock
  let socketConnectMock: jest.Mock
  let socketDisconnectMock: jest.Mock
  let socketReconnectIfTokenChangedMock: jest.Mock
  let socketSubscribeMock: jest.Mock
  let onConnectedHandler: (() => void) | undefined
  let listEventHandler: ((listId: string, seq: number) => void) | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    onConnectedHandler = undefined
    listEventHandler = undefined

    jest
      .spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >)

    flushMock = jest.fn().mockResolvedValue(undefined)
    reconcileMock = jest.fn().mockResolvedValue(undefined)
    pullMock = jest.fn().mockResolvedValue(undefined)
    pullListMock = jest.fn().mockResolvedValue(undefined)
    MockSyncEngine.mockImplementation(
      () =>
        ({
          flush: flushMock,
          reconcile: reconcileMock,
          pull: pullMock,
          pullList: pullListMock,
        }) as unknown as SyncEngine
    )

    socketConnectMock = jest.fn().mockResolvedValue(undefined)
    socketDisconnectMock = jest.fn()
    socketReconnectIfTokenChangedMock = jest.fn().mockResolvedValue(undefined)
    socketSubscribeMock = jest.fn()
    MockSyncSocket.mockImplementation((onConnected, onListEvent) => {
      onConnectedHandler = onConnected
      listEventHandler = onListEvent
      return {
        connect: socketConnectMock,
        disconnect: socketDisconnectMock,
        reconnectIfTokenChanged: socketReconnectIfTokenChangedMock,
        subscribe: socketSubscribeMock,
      } as unknown as SyncSocket
    })

    MockListSyncSettingsRepository.mockImplementation(
      () =>
        ({
          getEnabledIds: jest
            .fn()
            .mockResolvedValue(Result.ok(["list-1", "list-2"])),
        }) as unknown as ListSyncSettingsRepository
    )

    jest.spyOn(syncConfigModule, "isSyncConfigured").mockReturnValue(true)
  })

  function renderProvider() {
    return render(
      <SyncProvider>
        <Text>child</Text>
      </SyncProvider>
    )
  }

  it("does not flush, pull, subscribe, or connect the socket when signed out", async () => {
    mockAuth("signedOut")

    renderProvider()

    await flushMicrotasks()
    expect(flushMock).not.toHaveBeenCalled()
    expect(pullMock).not.toHaveBeenCalled()
    expect(socketSubscribeMock).not.toHaveBeenCalled()
    expect(socketConnectMock).not.toHaveBeenCalled()
  })

  it("does not flush, pull, subscribe, or connect the socket when sync is not configured, even if signed in", async () => {
    mockAuth("signedIn")
    jest.spyOn(syncConfigModule, "isSyncConfigured").mockReturnValue(false)

    renderProvider()

    await flushMicrotasks()
    expect(flushMock).not.toHaveBeenCalled()
    expect(pullMock).not.toHaveBeenCalled()
    expect(socketSubscribeMock).not.toHaveBeenCalled()
    expect(socketConnectMock).not.toHaveBeenCalled()
  })

  it("subscribes to sync-enabled lists on mount, before connecting", async () => {
    mockAuth("signedIn")

    renderProvider()

    await waitFor(() =>
      expect(socketSubscribeMock).toHaveBeenCalledWith(["list-1", "list-2"])
    )
  })

  it("flushes, pulls sync-enabled lists, and connects the socket once on mount when signed in and configured", async () => {
    mockAuth("signedIn")

    renderProvider()

    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))
    expect(socketConnectMock).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
    )
  })

  it("disconnects the socket when signed out after being signed in", async () => {
    mockAuth("signedIn")
    const { rerender } = renderProvider()
    await waitFor(() => expect(socketConnectMock).toHaveBeenCalledTimes(1))

    mockAuth("signedOut")
    rerender(
      <SyncProvider>
        <Text>child</Text>
      </SyncProvider>
    )

    expect(socketDisconnectMock).toHaveBeenCalled()
  })

  it("flushes again when the outbox reports a change", async () => {
    mockAuth("signedIn")

    renderProvider()
    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))

    notifyOutboxChanged()

    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(2))
  })

  it("starts flushing and connecting once status becomes signedIn after mounting signed out", async () => {
    mockAuth("signedOut")
    const { rerender } = renderProvider()

    await flushMicrotasks()
    expect(flushMock).not.toHaveBeenCalled()

    mockAuth("signedIn")
    rerender(
      <SyncProvider>
        <Text>child</Text>
      </SyncProvider>
    )

    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))
    expect(socketConnectMock).toHaveBeenCalledTimes(1)
  })

  it("pulls and reconciles sync-enabled list ids when the socket (re)connects", async () => {
    mockAuth("signedIn")
    renderProvider()
    await waitFor(() => expect(socketConnectMock).toHaveBeenCalledTimes(1))
    pullMock.mockClear()

    expect(onConnectedHandler).toBeDefined()
    onConnectedHandler!()

    await waitFor(() =>
      expect(reconcileMock).toHaveBeenCalledWith(["list-1", "list-2"])
    )
    expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
  })

  it("flushes, pulls, reconciles, and reconnects when the app comes to the foreground", async () => {
    mockAuth("signedIn")
    renderProvider()
    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))
    pullMock.mockClear()

    const emitAppStateChange = (
      AppState.addEventListener as jest.Mock
    ).mock.calls.find(([event]) => event === "change")?.[1]
    expect(emitAppStateChange).toBeDefined()

    emitAppStateChange("active")

    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(2))
    expect(reconcileMock).toHaveBeenCalled()
    expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
    expect(socketConnectMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("pulls and reconciles again on the periodic safety interval", async () => {
    jest.useFakeTimers()
    try {
      mockAuth("signedIn")
      renderProvider()
      await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))
      pullMock.mockClear()
      reconcileMock.mockClear()

      jest.advanceTimersByTime(5 * 60 * 1000)
      await flushMicrotasks()

      expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
      expect(reconcileMock).toHaveBeenCalledWith(["list-1", "list-2"])
    } finally {
      jest.useRealTimers()
    }
  })

  it("debounces a burst of list-event notifications for the same list into a single pullList call", async () => {
    jest.useFakeTimers()
    try {
      mockAuth("signedIn")
      renderProvider()
      await waitFor(() => expect(socketConnectMock).toHaveBeenCalledTimes(1))

      expect(listEventHandler).toBeDefined()
      listEventHandler!("list-1", 5)
      listEventHandler!("list-1", 6)
      listEventHandler!("list-1", 7)

      jest.advanceTimersByTime(400)
      await flushMicrotasks()

      expect(pullListMock).toHaveBeenCalledTimes(1)
      expect(pullListMock).toHaveBeenCalledWith("list-1")
    } finally {
      jest.useRealTimers()
    }
  })

  it("debounces list-event notifications independently per list", async () => {
    jest.useFakeTimers()
    try {
      mockAuth("signedIn")
      renderProvider()
      await waitFor(() => expect(socketConnectMock).toHaveBeenCalledTimes(1))

      expect(listEventHandler).toBeDefined()
      listEventHandler!("list-1", 5)
      listEventHandler!("list-2", 9)

      jest.advanceTimersByTime(400)
      await flushMicrotasks()

      expect(pullListMock).toHaveBeenCalledTimes(2)
      expect(pullListMock).toHaveBeenCalledWith("list-1")
      expect(pullListMock).toHaveBeenCalledWith("list-2")
    } finally {
      jest.useRealTimers()
    }
  })
})
