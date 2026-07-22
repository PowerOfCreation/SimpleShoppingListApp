import { formatPriority, priorityColorKey } from "@/utils/priority"
import { Priority } from "@/types/Priority"

describe("formatPriority", () => {
  it("formats NOW", () => {
    expect(formatPriority(Priority.NOW)).toBe("Now")
  })

  it("formats DAYS_1_TO_3", () => {
    expect(formatPriority(Priority.DAYS_1_TO_3)).toBe("1-3 days")
  })

  it("formats DAYS_4_PLUS", () => {
    expect(formatPriority(Priority.DAYS_4_PLUS)).toBe("4+ days")
  })
})

describe("priorityColorKey", () => {
  it("maps NOW to prioUrgent", () => {
    expect(priorityColorKey(Priority.NOW)).toBe("prioUrgent")
  })

  it("maps DAYS_1_TO_3 to prio13", () => {
    expect(priorityColorKey(Priority.DAYS_1_TO_3)).toBe("prio13")
  })

  it("maps DAYS_4_PLUS to prio4plus", () => {
    expect(priorityColorKey(Priority.DAYS_4_PLUS)).toBe("prio4plus")
  })
})
