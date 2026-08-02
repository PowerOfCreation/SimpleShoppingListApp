import { byServerSeqThenLocal, DomainEventRow } from "../DomainEvent"

const makeEvent = (event_id: string, seq: number | null): DomainEventRow => ({
  event_id,
  event_type: "todo_list.created",
  aggregate_id: "list-1",
  aggregate_type: "todo_list",
  list_id: "list-1",
  occurred_at: 1000,
  client_id: "client-1",
  payload: "{}",
  seq,
})

describe("byServerSeqThenLocal", () => {
  it("orders two confirmed events by seq ascending", () => {
    const events = [makeEvent("high", 5), makeEvent("low", 1)]

    expect(events.sort(byServerSeqThenLocal).map((e) => e.event_id)).toEqual([
      "low",
      "high",
    ])
  })

  it("sorts a confirmed event ahead of an unconfirmed one, regardless of input order", () => {
    const confirmedFirst = [makeEvent("confirmed", 1), makeEvent("local", null)]
    const confirmedLast = [makeEvent("local", null), makeEvent("confirmed", 1)]

    expect(
      confirmedFirst.sort(byServerSeqThenLocal).map((e) => e.event_id)
    ).toEqual(["confirmed", "local"])
    expect(
      confirmedLast.sort(byServerSeqThenLocal).map((e) => e.event_id)
    ).toEqual(["confirmed", "local"])
  })

  it("treats two unconfirmed events as equal, leaving a stable sort to preserve their given order", () => {
    expect(
      byServerSeqThenLocal(makeEvent("a", null), makeEvent("b", null))
    ).toBe(0)
  })

  it("treats two confirmed events with the same seq as equal", () => {
    expect(byServerSeqThenLocal(makeEvent("a", 3), makeEvent("b", 3))).toBe(0)
  })
})
