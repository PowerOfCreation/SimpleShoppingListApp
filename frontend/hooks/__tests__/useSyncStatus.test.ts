import { act, renderHook } from "@testing-library/react-native"
import { useNetworkState } from "expo-network"

import { useSyncStatus } from "../useSyncStatus"
import { reportSyncStarted } from "@/api/sync/sync-status"

jest.mock("expo-network", () => ({ useNetworkState: jest.fn() }))

const mockNetworkState = jest.mocked(useNetworkState)

beforeEach(() => {
  mockNetworkState.mockReturnValue({
    isConnected: true,
    isInternetReachable: true,
  })
  reportSyncStarted().finish(true)
})

it("shows sync failures while the device is online", () => {
  const { result } = renderHook(() => useSyncStatus())
  act(() => reportSyncStarted().finish(false))
  expect(result.current).toBe("error")
})

it.each([
  { isConnected: false },
  { isConnected: true, isInternetReachable: false },
])("keeps offline visible during automatic sync attempts: %j", (network) => {
  mockNetworkState.mockReturnValue(network)
  const { result } = renderHook(() => useSyncStatus())
  expect(result.current).toBe("offline")
  let finish!: (ok: boolean) => void
  act(() => {
    finish = reportSyncStarted().finish
  })
  expect(result.current).toBe("offline")
  act(() => finish(false))
  expect(result.current).toBe("offline")
})

it("preserves the failed sync after reconnecting until a new sync succeeds", () => {
  mockNetworkState.mockReturnValue({ isConnected: false })
  const { result, rerender } = renderHook(() => useSyncStatus())
  act(() => reportSyncStarted().finish(false))
  mockNetworkState.mockReturnValue({ isConnected: true })
  rerender({})
  expect(result.current).toBe("error")
  let finish!: (ok: boolean) => void
  act(() => {
    finish = reportSyncStarted().finish
  })
  expect(result.current).toBe("syncing")
  act(() => finish(true))
  expect(result.current).toBe("synced")
})

it("does not classify unknown connectivity as offline", () => {
  mockNetworkState.mockReturnValue({})
  const { result } = renderHook(() => useSyncStatus())
  expect(result.current).toBe("synced")
  act(() => reportSyncStarted().finish(false))
  expect(result.current).toBe("error")
})
