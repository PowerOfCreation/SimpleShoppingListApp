import { runExclusive } from "../write-lock"

describe("runExclusive", () => {
  it("runs callbacks one at a time in call order", async () => {
    const order: string[] = []

    const first = runExclusive(async () => {
      order.push("first-start")
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push("first-end")
      return "first"
    })

    const second = runExclusive(async () => {
      order.push("second-start")
      order.push("second-end")
      return "second"
    })

    expect(await first).toBe("first")
    expect(await second).toBe("second")
    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end",
    ])
  })

  it("does not let a rejected callback block or corrupt later callers", async () => {
    const first = runExclusive(async () => {
      throw new Error("boom")
    })

    const second = runExclusive(async () => "second-result")

    await expect(first).rejects.toThrow("boom")
    expect(await second).toBe("second-result")
  })

  it("a later caller cannot observe or roll back an earlier caller's work", async () => {
    let sharedState = 0

    const first = runExclusive(async () => {
      sharedState = 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      // If runExclusive actually serializes, nothing else can run between
      // this write and the read below.
      expect(sharedState).toBe(1)
      sharedState = 2
    })

    const second = runExclusive(async () => {
      sharedState = 3
    })

    await first
    await second
    expect(sharedState).toBe(3)
  })
})
