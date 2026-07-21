export const Priority = {
  NOW: 0,
  DAYS_1_TO_3: 100,
  DAYS_4_PLUS: 200,
} as const

export type Priority = (typeof Priority)[keyof typeof Priority]
