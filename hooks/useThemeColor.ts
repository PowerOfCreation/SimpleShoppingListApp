import { useColorScheme } from "react-native"
import { Colors } from "@/constants/Colors"

type ColorScheme = "light" | "dark"

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const theme: ColorScheme = useColorScheme() === "dark" ? "dark" : "light"
  const colorFromProps = props[theme]

  return colorFromProps ?? Colors[theme][colorName]
}