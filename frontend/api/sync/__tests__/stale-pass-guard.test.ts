import {
  startGuardedPass,
  touchSyncProgress,
  clearGuardScope,
} from "../stale-pass-guard"
import { REQUEST_TIMEOUT_MS } from "@/api/sync/config"

const STALE_AFTER_MS = REQUEST_TIMEOUT_MS * 3

it("fires onStale once a scope goes quiet past its budget", () => {
  jest.useFakeTimers()
  try {
    const onStale = jest.fn()
    startGuardedPass("list-1", onStale)
    jest.advanceTimersByTime(STALE_AFTER_MS)
    expect(onStale).toHaveBeenCalledTimes(1)
  } finally {
    jest.useRealTimers()
  }
})

it("does not fire while touchSyncProgress keeps renewing the scope", () => {
  jest.useFakeTimers()
  try {
    const onStale = jest.fn()
    startGuardedPass("list-2", onStale)
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(STALE_AFTER_MS - 5_000)
      touchSyncProgress(["list-2"])
    }
    expect(onStale).not.toHaveBeenCalled()
  } finally {
    jest.useRealTimers()
  }
})

it("a second pass on the same scope keeps the first alive without either touching directly (nesting)", () => {
  jest.useFakeTimers()
  try {
    const onStaleOuter = jest.fn()
    startGuardedPass("list-3", onStaleOuter)
    const inner = startGuardedPass("list-3", jest.fn())
    jest.advanceTimersByTime(STALE_AFTER_MS - 5_000)
    touchSyncProgress(["list-3"])
    jest.advanceTimersByTime(STALE_AFTER_MS - 5_000)
    expect(onStaleOuter).not.toHaveBeenCalled()
    inner.finish()
  } finally {
    jest.useRealTimers()
  }
})

it("finish() is idempotent and reports whether it actually retired the pass", () => {
  const pass = startGuardedPass("list-4", jest.fn())
  expect(pass.finish()).toBe(true)
  expect(pass.finish()).toBe(false)
})

it("finish() reports false for a pass the watchdog already gave up on, and does not resurrect it", () => {
  jest.useFakeTimers()
  try {
    const onStale = jest.fn()
    const pass = startGuardedPass("list-5", onStale)
    jest.advanceTimersByTime(STALE_AFTER_MS)
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(pass.finish()).toBe(false)
  } finally {
    jest.useRealTimers()
  }
})

it("touchSyncProgress is a no-op for a scope with no open pass", () => {
  expect(() => touchSyncProgress(["untouched", null])).not.toThrow()
})

it("a pass joining a near-expiring scope gets its own full budget, not whatever time the scope had left", () => {
  jest.useFakeTimers()
  try {
    const onStaleFirst = jest.fn()
    startGuardedPass("list-6", onStaleFirst)
    // Right up against the first pass's own deadline - a naive shared timer
    // would fire moments after the second pass joins, treating a pass that
    // just started as already stale.
    jest.advanceTimersByTime(STALE_AFTER_MS - 1_000)
    const onStaleSecond = jest.fn()
    startGuardedPass("list-6", onStaleSecond)
    jest.advanceTimersByTime(2_000)
    expect(onStaleFirst).not.toHaveBeenCalled()
    expect(onStaleSecond).not.toHaveBeenCalled()
  } finally {
    jest.useRealTimers()
  }
})

it("clearGuardScope drops a leftover timer so a later reuse of the same key starts with a full budget", () => {
  jest.useFakeTimers()
  try {
    const onStaleFirst = jest.fn()
    startGuardedPass("list-7", onStaleFirst)
    jest.advanceTimersByTime(STALE_AFTER_MS - 1_000)
    clearGuardScope("list-7")

    const onStaleSecond = jest.fn()
    startGuardedPass("list-7", onStaleSecond)
    jest.advanceTimersByTime(2_000)

    expect(onStaleSecond).not.toHaveBeenCalled()
  } finally {
    jest.useRealTimers()
  }
})
