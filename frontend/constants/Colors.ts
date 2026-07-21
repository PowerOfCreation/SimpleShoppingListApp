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
    text: "#0e171e",
    textSecondary: "#515960",
    background: "#f6f9fb",
    surface: "#ffffff",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
    divider: "#d9dfe3",
    dividerSubtle: "#cccccc",
    accent: "#026fd7",
    onAccent: "#ffffff",
    amber: "#bc5e00",
    prioUrgent: "#be2517",
    prio13: "#7260bd",
    prio4plus: "#5b646f",
    danger: "#b71824",
  },
  dark: {
    text: "#eceff2",
    textSecondary: "#999fa6",
    background: "#0a0e11",
    surface: "#171d22",
    tint: tintColorDark,
    icon: "#9BA1A6",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
    divider: "#33393f",
    dividerSubtle: "#555555",
    accent: "#70adfb",
    onAccent: "#06090d",
    amber: "#f0a646",
    prioUrgent: "#ef6856",
    prio13: "#a495f0",
    prio4plus: "#89939e",
    danger: "#fd736d",
  },
}
