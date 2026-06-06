import { useNavigation } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { StyleSheet, TouchableOpacity } from "react-native"
import type { ColorValue } from "react-native"

type Props = {
  tintColor?: ColorValue
  accessibilityLabel?: string
}

export function DrawerToggleButton({
  tintColor,
  accessibilityLabel = "Toggle navigation menu",
}: Props) {
  const navigation = useNavigation()

  return (
    <TouchableOpacity
      onPress={() => navigation.dispatch({ type: "TOGGLE_DRAWER" })}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={styles.button}
    >
      <Ionicons name="menu" size={24} color={tintColor as string} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    marginLeft: 8,
    padding: 4,
  },
})
