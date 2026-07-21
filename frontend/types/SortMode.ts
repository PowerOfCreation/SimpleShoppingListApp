export const SortMode = {
  DATE: "date",
  PRIORITY: "priority",
} as const

export type SortMode = (typeof SortMode)[keyof typeof SortMode]
