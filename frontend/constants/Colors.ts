/** Theme-independent semantic colors for actions and UI states */
export const Palette = {
  error: "red",
  success: "#34C759", // confirm / save
  neutral: "#8E8E93", // cancel / secondary
  destructive: "#ff3b30", // delete / danger
  primary: "#1999b3", // primary icon accent
  progressCompleted: "#2196F3",
  progressIncomplete: "#FF9800",
  shadow: "#000000",
  white: "#ffffff",
} as const

const tintColorLight = "#0a7ea4"
const tintColorDark = "#fff"

export const Colors = {
  light: {
    text: "#11181C",
    background: "#fff",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
    divider: "#e0e0e0",
    dividerSubtle: "#cccccc",
    actionButtonBg: "#ffffff",
    actionButtonBorder: "rgba(0,0,0,0.2)",
    cardSurface: "#f5f5f5",
    cardSurfaceCompleted: "#e0e0e0",
    completedItemText: "#00400b",
    defaultItemText: "#333333",
  },
  dark: {
    text: "#ECEDEE",
    background: "#151718",
    tint: tintColorDark,
    icon: "#9BA1A6",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
    divider: "#808080",
    dividerSubtle: "#555555",
    actionButtonBg: "#2e2e2e",
    actionButtonBorder: "rgba(255,255,255,0.15)",
    cardSurface: "#2e2e2e",
    cardSurfaceCompleted: "#121212",
    completedItemText: "#4caf50",
    defaultItemText: "#ffffff",
  },
}
