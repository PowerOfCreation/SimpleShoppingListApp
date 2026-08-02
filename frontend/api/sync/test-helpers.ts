// Drains pending promise chains (e.g. fire-and-forget subscribe/pull/flush
// calls) regardless of exact hop count. Plain microtask loop, not
// setImmediate - several sync tests run under jest.useFakeTimers(), which
// fakes setImmediate too; native promise microtasks aren't affected by it.
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}
