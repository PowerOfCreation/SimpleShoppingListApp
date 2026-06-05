import React from "react"
import { Stack } from "expo-router"
import { useThemeColor } from "@/hooks/useThemeColor"
import { DrawerToggleButton } from "@react-navigation/drawer"

function HeaderLeft({ color }: { color: string }) {
  return <DrawerToggleButton tintColor={color} />
}

export default function EventsLayout() {
  const backgroundColor = useThemeColor({}, "background")
  const color = useThemeColor({}, "text")

  const headerLeft = React.useCallback(
    () => <HeaderLeft color={color} />,
    [color]
  )

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor },
        headerTintColor: color,
        contentStyle: { backgroundColor },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerTitle: "Event Log",
          headerLeft,
        }}
      />
    </Stack>
  )
}
