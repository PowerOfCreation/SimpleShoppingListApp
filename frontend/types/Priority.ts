export const Priority = {
  NOW: 0,
  DAYS_1_TO_3: 100,
  DAYS_4_PLUS: 200,
} as const

// eslint-disable-next-line @typescript-eslint/no-redeclare -- type/value namespace merge, not an actual redeclaration
export type Priority = (typeof Priority)[keyof typeof Priority]
