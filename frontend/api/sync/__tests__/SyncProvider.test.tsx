import React from "react"
import { render, waitFor } from "@testing-library/react-native"
import { Text, AppState } from "react-native"

import { SyncProvider } from "../SyncProvider"
import { useAuth } from "@/api/auth/AuthProvider"
import { SyncEngine } from "@/api/sync/sync-engine"
import { SyncSocket } from "@/api/sync/sync-socket"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { Result } from "@/api/common/result"
import { notifyOutboxChanged } from "@/api/sync/outbox-events"
import * as syncConfigModule from "@/api/sync/config"

jest.mock("@/api/auth/AuthProvider")
jest.mock("@/api/sync/sync-engine")
jest.mock("@/api/sync/sync-socket")
jest.mock("@/database/database", () => ({
  getDatabase: jest.fn(() => ({})),
}))
jest.mock("@/database/outbox-repository")
jest.mock("@/database/event-repository")
jest.mock("@/database/ingredient-list-repository")
jest.mock("@/api/sync/sync-client")

const mockedUseAuth = useAuth as jest.Mock
const MockSyncEngine = SyncEngine as jest.MockedClass<typeof SyncEngine>
const MockSyncSocket = SyncSocket as jest.MockedClass<typeof SyncSocket>
const MockIngredientListRepository =
  IngredientListRepository as jest.MockedClass<typeof IngredientListRepository>

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
  let handleAckMock: jest.Mock
  let reconcileMock: jest.Mock
  let socketConnectMock: jest.Mock
  let socketDisconnectMock: jest.Mock
  let socketReconnectIfTokenChangedMock: jest.Mock
  let ackHandler: ((eventId: string) => void) | undefined
  let onConnectedHandler: (() => void) | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    ackHandler = undefined
    onConnectedHandler = undefined

    jest
      .spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >)

    flushMock = jest.fn().mockResolvedValue(undefined)
    handleAckMock = jest.fn().mockResolvedValue(undefined)
    reconcileMock = jest.fn().mockResolvedValue(undefined)
    MockSyncEngine.mockImplementation(
      () =>
        ({
          flush: flushMock,
          handleAck: handleAckMock,
          reconcile: reconcileMock,
        }) as unknown as SyncEngine
    )

    socketConnectMock = jest.fn().mockResolvedValue(undefined)
    socketDisconnectMock = jest.fn()
    socketReconnectIfTokenChangedMock = jest.fn().mockResolvedValue(undefined)
    MockSyncSocket.mockImplementation((onAck, onConnected) => {
      ackHandler = onAck
      onConnectedHandler = onConnected
      return {
        connect: socketConnectMock,
        disconnect: socketDisconnectMock,
        reconnectIfTokenChanged: socketReconnectIfTokenChangedMock,
      } as unknown as SyncSocket
    })

    MockIngredientListRepository.mockImplementation(
      () =>
        ({
          getSyncEnabledIds: jest
            .fn()
            .mockResolvedValue(Result.ok(["list-1", "list-2"])),
        }) as unknown as IngredientListRepository
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

  it("does not flush or connect the socket when signed out", async () => {
    mockAuth("signedOut")

    renderProvider()

    await Promise.resolve()
    expect(flushMock).not.toHaveBeenCalled()
    expect(socketConnectMock).not.toHaveBeenCalled()
  })

  it("does not flush or connect the socket when sync is not configured, even if signed in", async () => {
    mockAuth("signedIn")
    jest.spyOn(syncConfigModule, "isSyncConfigured").mockReturnValue(false)

    renderProvider()

    await Promise.resolve()
    expect(flushMock).not.toHaveBeenCalled()
    expect(socketConnectMock).not.toHaveBeenCalled()
  })

  it("flushes and connects the socket once on mount when signed in and configured", async () => {
    mockAuth("signedIn")

    renderProvider()

    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))
    expect(socketConnectMock).toHaveBeenCalledTimes(1)
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

    await Promise.resolve()
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

  it("wires the socket's ack messages to engine.handleAck", async () => {
    mockAuth("signedIn")
    renderProvider()
    await waitFor(() => expect(socketConnectMock).toHaveBeenCalledTimes(1))

    expect(ackHandler).toBeDefined()
    ackHandler!("evt-123")

    expect(handleAckMock).toHaveBeenCalledWith("evt-123")
  })

  it("reconciles sync-enabled list ids when the socket (re)connects", async () => {
    mockAuth("signedIn")
    renderProvider()
    await waitFor(() => expect(socketConnectMock).toHaveBeenCalledTimes(1))

    expect(onConnectedHandler).toBeDefined()
    onConnectedHandler!()

    await waitFor(() =>
      expect(reconcileMock).toHaveBeenCalledWith(["list-1", "list-2"])
    )
  })

  it("flushes, reconciles, and reconnects when the app comes to the foreground", async () => {
    mockAuth("signedIn")
    renderProvider()
    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))

    const emitAppStateChange = (
      AppState.addEventListener as jest.Mock
    ).mock.calls.find(([event]) => event === "change")?.[1]
    expect(emitAppStateChange).toBeDefined()

    emitAppStateChange("active")

    await waitFor(() => expect(flushMock).toHaveBeenCalledTimes(2))
    expect(reconcileMock).toHaveBeenCalled()
    expect(socketConnectMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
