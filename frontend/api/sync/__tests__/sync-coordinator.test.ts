import { AppState } from "react-native"

import { SyncCoordinator } from "../sync-coordinator"
import { SyncEngine } from "@/api/sync/sync-engine"
import { SyncSocket } from "@/api/sync/sync-socket"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { Result } from "@/api/common/result"
import { SharingError } from "@/api/common/error-types"
import { notifyOutboxChanged } from "@/api/sync/outbox-events"
import { notifySyncListsChanged } from "@/api/sync/sync-events"
import { flushMicrotasks } from "../test-helpers"

jest.mock("@/api/sync/sync-engine")
jest.mock("@/api/sync/sync-socket")
jest.mock("@/database/list-sync-settings-repository")

const MockSyncEngine = SyncEngine as jest.MockedClass<typeof SyncEngine>
const MockSyncSocket = SyncSocket as jest.MockedClass<typeof SyncSocket>
const MockListSyncSettingsRepository =
  ListSyncSettingsRepository as jest.MockedClass<
    typeof ListSyncSettingsRepository
  >

describe("SyncCoordinator", () => {
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
  let appStateRemoveMock: jest.Mock
  let coordinators: SyncCoordinator[]
  let listMyListsMock: jest.Mock
  let setEnabledMock: jest.Mock
  let getEnabledIdsMock: jest.Mock
  let getKnownIdsMock: jest.Mock

  function buildCoordinator(): SyncCoordinator {
    const coordinator = new SyncCoordinator(
      new MockSyncEngine(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      ),
      new MockListSyncSettingsRepository({} as never),
      { listMyLists: listMyListsMock }
    )
    coordinators.push(coordinator)
    return coordinator
  }

  afterEach(() => {
    coordinators.forEach((coordinator) => coordinator.stop())
  })

  beforeEach(() => {
    jest.clearAllMocks()
    coordinators = []
    onConnectedHandler = undefined
    listEventHandler = undefined

    appStateRemoveMock = jest.fn()
    jest
      .spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove: appStateRemoveMock } as unknown as ReturnType<
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

    listMyListsMock = jest.fn().mockResolvedValue(Result.ok([]))
    setEnabledMock = jest.fn().mockResolvedValue(Result.ok(undefined))
    getEnabledIdsMock = jest
      .fn()
      .mockResolvedValue(Result.ok(["list-1", "list-2"]))
    getKnownIdsMock = jest
      .fn()
      .mockResolvedValue(Result.ok(["list-1", "list-2"]))
    MockListSyncSettingsRepository.mockImplementation(
      () =>
        ({
          getEnabledIds: getEnabledIdsMock,
          getKnownIds: getKnownIdsMock,
          setEnabled: setEnabledMock,
        }) as unknown as ListSyncSettingsRepository
    )
  })

  it("subscribes before connecting, then pulls and flushes on start()", async () => {
    const coordinator = buildCoordinator()

    coordinator.start()
    await flushMicrotasks()

    expect(socketSubscribeMock).toHaveBeenCalledWith(["list-1", "list-2"])
    expect(socketConnectMock).toHaveBeenCalledTimes(1)
    expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
    expect(flushMock).toHaveBeenCalledTimes(1)
  })

  it("is idempotent: a second start() while already running does not double-register triggers", async () => {
    jest.useFakeTimers()
    try {
      const coordinator = buildCoordinator()

      coordinator.start()
      coordinator.start()
      await flushMicrotasks()

      expect(socketConnectMock).toHaveBeenCalledTimes(1)
      expect(AppState.addEventListener).toHaveBeenCalledTimes(1)

      flushMock.mockClear()
      notifyOutboxChanged()
      expect(flushMock).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it("pulls and reconciles sync-enabled lists when the socket (re)connects", async () => {
    buildCoordinator().start()
    pullMock.mockClear()

    expect(onConnectedHandler).toBeDefined()
    onConnectedHandler!()
    await flushMicrotasks()

    expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
    expect(reconcileMock).toHaveBeenCalledWith(["list-1", "list-2"])
  })

  it("waits for pull to finish before starting reconcile on socket connect", async () => {
    // reconcile's drift check compares the pull cursor against the server
    // head - it must not race a pull still moving that cursor (see
    // sync-design-decisions.md, "Reparatur: voller Re-Pull").
    let resolvePull: (() => void) | undefined
    pullMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePull = resolve
        })
    )

    buildCoordinator().start()
    reconcileMock.mockClear()

    onConnectedHandler!()
    await flushMicrotasks()

    expect(reconcileMock).not.toHaveBeenCalled()

    resolvePull!()
    await flushMicrotasks()

    expect(reconcileMock).toHaveBeenCalledWith(["list-1", "list-2"])
  })

  it("flushes again when the outbox reports a change", async () => {
    buildCoordinator().start()
    await flushMicrotasks()
    flushMock.mockClear()

    notifyOutboxChanged()

    expect(flushMock).toHaveBeenCalledTimes(1)
  })

  it("re-subscribes and pulls when the sync-enabled list set changes", async () => {
    buildCoordinator().start()
    await flushMicrotasks()
    socketSubscribeMock.mockClear()
    pullMock.mockClear()

    notifySyncListsChanged()
    await flushMicrotasks()

    expect(socketSubscribeMock).toHaveBeenCalledWith(["list-1", "list-2"])
    expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
  })

  it("on start(), enables sync for lists the server reports but this device doesn't know yet, then re-subscribes and re-pulls", async () => {
    listMyListsMock.mockResolvedValue(
      Result.ok([
        { listId: "list-1", role: "owner" },
        { listId: "list-3", role: "member" },
      ])
    )
    socketSubscribeMock.mockClear()

    buildCoordinator().start()
    await flushMicrotasks()

    // list-1 already has a local row (getKnownIds) - only the unknown
    // list-3 is new.
    expect(setEnabledMock).toHaveBeenCalledTimes(1)
    expect(setEnabledMock).toHaveBeenCalledWith("list-3", true)
    // notifySyncListsChanged() re-reads getEnabledIds(), still mocked to
    // return list-1/list-2 - discoverLists doesn't change what that mock
    // returns, it only proves the follow-up subscribe/pull fired.
    expect(socketSubscribeMock).toHaveBeenCalledWith(["list-1", "list-2"])
  })

  it("on start(), does nothing further when the server reports no lists this device doesn't already have", async () => {
    listMyListsMock.mockResolvedValue(
      Result.ok([{ listId: "list-1", role: "owner" }])
    )

    buildCoordinator().start()
    await flushMicrotasks()

    expect(setEnabledMock).not.toHaveBeenCalled()
  })

  it("on start(), does not re-enable a list the user explicitly turned sync off for", async () => {
    // list-1 has a local row (enabled=0, e.g. the user toggled sync off) -
    // getEnabledIds() no longer reports it, but getKnownIds() still does,
    // since the row itself wasn't removed.
    getEnabledIdsMock.mockResolvedValue(Result.ok(["list-2"]))
    getKnownIdsMock.mockResolvedValue(Result.ok(["list-1", "list-2"]))
    listMyListsMock.mockResolvedValue(
      Result.ok([{ listId: "list-1", role: "owner" }])
    )

    buildCoordinator().start()
    await flushMicrotasks()

    expect(setEnabledMock).not.toHaveBeenCalled()
  })

  it("on start(), logs and continues when fetching my lists fails", async () => {
    listMyListsMock.mockResolvedValue(
      Result.fail(new SharingError("network error", "network"))
    )

    const coordinator = buildCoordinator()
    expect(() => coordinator.start()).not.toThrow()
    await flushMicrotasks()

    expect(setEnabledMock).not.toHaveBeenCalled()
  })

  it("flushes, pulls, reconciles, and reconnects when the app comes to the foreground", async () => {
    buildCoordinator().start()
    await flushMicrotasks()
    flushMock.mockClear()
    pullMock.mockClear()
    socketConnectMock.mockClear()

    const emitAppStateChange = (AppState.addEventListener as jest.Mock).mock
      .calls[0][1]
    emitAppStateChange("active")
    await flushMicrotasks()

    expect(flushMock).toHaveBeenCalledTimes(1)
    expect(reconcileMock).toHaveBeenCalledWith(["list-1", "list-2"])
    expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
    expect(socketConnectMock).toHaveBeenCalledTimes(1)
  })

  it("pulls and reconciles again on the periodic safety interval", async () => {
    jest.useFakeTimers()
    try {
      buildCoordinator().start()
      await flushMicrotasks()
      pullMock.mockClear()
      reconcileMock.mockClear()

      jest.advanceTimersByTime(5 * 60 * 1000)
      await flushMicrotasks()

      expect(pullMock).toHaveBeenCalledWith(["list-1", "list-2"])
      expect(reconcileMock).toHaveBeenCalledWith(["list-1", "list-2"])
      expect(socketReconnectIfTokenChangedMock).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it("debounces a burst of list-event notifications for the same list into a single pullList call", async () => {
    jest.useFakeTimers()
    try {
      buildCoordinator().start()

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

  it("stop() unsubscribes every trigger, cancels pending debounced pulls, and disconnects the socket", async () => {
    jest.useFakeTimers()
    try {
      const coordinator = buildCoordinator()
      coordinator.start()
      await flushMicrotasks()
      listEventHandler!("list-1", 5)

      coordinator.stop()

      expect(appStateRemoveMock).toHaveBeenCalledTimes(1)
      expect(socketDisconnectMock).toHaveBeenCalledTimes(1)

      flushMock.mockClear()
      pullListMock.mockClear()
      notifyOutboxChanged()
      jest.advanceTimersByTime(400)
      await flushMicrotasks()

      expect(flushMock).not.toHaveBeenCalled()
      expect(pullListMock).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it("stop() is safe to call without a prior start()", () => {
    expect(() => buildCoordinator().stop()).not.toThrow()
  })

  it("re-arms on start() after stop()", async () => {
    const coordinator = buildCoordinator()
    coordinator.start()
    coordinator.stop()
    socketConnectMock.mockClear()

    coordinator.start()
    await flushMicrotasks()

    expect(socketConnectMock).toHaveBeenCalledTimes(1)
  })
})
