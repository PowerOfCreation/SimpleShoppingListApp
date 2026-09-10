import { startGuardedPass, clearGuardScope } from "../stale-pass-guard"

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

it("expires a pass once and ignores late progress and completion", () => {
  const stale = jest.fn()
  const pass = startGuardedPass("list", stale)
  jest.advanceTimersByTime(30_000)
  pass.progress()
  expect(pass.finish()).toBe(false)
  jest.advanceTimersByTime(30_000)
  expect(stale).toHaveBeenCalledTimes(1)
})

it("finishes idempotently and removes its timer", () => {
  const pass = startGuardedPass("list", jest.fn())
  expect(pass.finish()).toBe(true)
  expect(pass.finish()).toBe(false)
  expect(jest.getTimerCount()).toBe(0)
})

it("only renews explicitly linked parents, not independent work on the same key", () => {
  const unrelatedStale = jest.fn()
  startGuardedPass("list", unrelatedStale)
  const parentStale = jest.fn()
  const parent = startGuardedPass("list", parentStale)
  const childStale = jest.fn()
  const child = startGuardedPass("list", childStale, parent.progress)
  for (let i = 0; i < 5; i++) {
    jest.advanceTimersByTime(25_000)
    child.progress()
  }
  expect(unrelatedStale).toHaveBeenCalledTimes(1)
  expect(parentStale).not.toHaveBeenCalled()
  expect(childStale).not.toHaveBeenCalled()
  child.finish()
  parent.finish()
})

it("gives a joining pass a full budget without renewing an older unrelated pass", () => {
  const first = jest.fn()
  startGuardedPass("list", first)
  jest.advanceTimersByTime(29_000)
  const second = jest.fn()
  const pass = startGuardedPass("list", second)
  jest.advanceTimersByTime(2_000)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).not.toHaveBeenCalled()
  pass.finish()
})

it("clearing a key invalidates old handles without affecting later reuse", () => {
  const first = jest.fn()
  const old = startGuardedPass("list", first)
  clearGuardScope("list")
  const second = jest.fn()
  const fresh = startGuardedPass("list", second)
  jest.advanceTimersByTime(29_000)
  old.progress()
  expect(old.finish()).toBe(false)
  jest.advanceTimersByTime(1_000)
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(1)
  expect(fresh.finish()).toBe(false)
})
