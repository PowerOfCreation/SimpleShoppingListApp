import { renderHook } from "@testing-library/react-native"
import { AppState, AppStateStatus } from "react-native"
import { useDatabaseLifecycle } from "../useDatabaseLifecycle"
import { resetDatabase } from "@/database/database"

// Mock the database module
jest.mock("@/database/database", () => ({
  resetDatabase: jest.fn(),
}))

// Mock the logger
jest.mock("@/api/common/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}))

describe("useDatabaseLifecycle", () => {
  let mockAddEventListenerReturnValue: { remove: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock AppState.addEventListener to return a removable subscription
    mockAddEventListenerReturnValue = {
      remove: jest.fn(),
    }

    ;(AppState.addEventListener as jest.Mock).mockReturnValue(
      mockAddEventListenerReturnValue
    )
  })

  it("should subscribe to app state changes on mount", () => {
    renderHook(() => useDatabaseLifecycle())

    expect(AppState.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function)
    )
  })

  it("should reset database when app moves to background", () => {
    const { result } = renderHook(() => useDatabaseLifecycle())

    // Get the callback that was passed to addEventListener
    const callback = (AppState.addEventListener as jest.Mock).mock.calls[0][1]

    // Simulate app moving to background
    callback("background" as AppStateStatus)

    expect(resetDatabase).toHaveBeenCalled()
  })

  it("should not reset database when app moves to foreground", () => {
    const { result } = renderHook(() => useDatabaseLifecycle())

    // Get the callback that was passed to addEventListener
    const callback = (AppState.addEventListener as jest.Mock).mock.calls[0][1]

    // Simulate app moving to foreground
    callback("active" as AppStateStatus)

    expect(resetDatabase).not.toHaveBeenCalled()
  })

  it("should not reset database when app is inactive", () => {
    const { result } = renderHook(() => useDatabaseLifecycle())

    // Get the callback that was passed to addEventListener
    const callback = (AppState.addEventListener as jest.Mock).mock.calls[0][1]

    // Simulate app becoming inactive
    callback("inactive" as AppStateStatus)

    expect(resetDatabase).not.toHaveBeenCalled()
  })

  it("should unsubscribe from app state changes on unmount", () => {
    const { unmount } = renderHook(() => useDatabaseLifecycle())

    expect(mockAddEventListenerReturnValue.remove).not.toHaveBeenCalled()

    unmount()

    expect(mockAddEventListenerReturnValue.remove).toHaveBeenCalled()
  })

  it("should handle multiple app state changes correctly", () => {
    const { result } = renderHook(() => useDatabaseLifecycle())

    // Get the callback that was passed to addEventListener
    const callback = (AppState.addEventListener as jest.Mock).mock.calls[0][1]

    // First transition to background
    callback("background" as AppStateStatus)
    expect(resetDatabase).toHaveBeenCalledTimes(1)

    // Transition to active (should not reset)
    callback("active" as AppStateStatus)
    expect(resetDatabase).toHaveBeenCalledTimes(1)

    // Transition to background again
    callback("background" as AppStateStatus)
    expect(resetDatabase).toHaveBeenCalledTimes(2)
  })
})
