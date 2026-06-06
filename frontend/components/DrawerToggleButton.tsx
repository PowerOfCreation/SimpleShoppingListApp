import { useNavigation } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { TouchableOpacity } from "react-native"
import type { ColorValue } from "react-native"

type Props = {
  tintColor?: ColorValue
  accessibilityLabel?: string
}

export function DrawerToggleButton({
  tintColor,
  accessibilityLabel = "Toggle navigation menu",
}: Props) {
  const navigation = useNavigation() as { toggleDrawer: () => void }

  return (
    <TouchableOpacity
      onPress={() => navigation.toggleDrawer()}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={{ marginLeft: 8, padding: 4 }}
    >
      <Ionicons name="menu" size={24} color={tintColor as string} />
    </TouchableOpacity>
  )
}
