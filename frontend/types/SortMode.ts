export const SortMode = {
  DATE: "date",
  PRIORITY: "priority",
} as const

// eslint-disable-next-line @typescript-eslint/no-redeclare -- type/value namespace merge, not an actual redeclaration
export type SortMode = (typeof SortMode)[keyof typeof SortMode]
