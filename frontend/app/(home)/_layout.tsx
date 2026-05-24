import React from "react"
import { Stack } from "expo-router"
import { useThemeColor } from "@/hooks/useThemeColor"
import { DrawerToggleButton } from "@react-navigation/drawer"

function HeaderLeft({ color }: { color: string }) {
  return <DrawerToggleButton tintColor={color} />
}

export default function HomeLayout() {
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
          headerTitle: "Shopping Lists",
          headerLeft,
        }}
      />
      <Stack.Screen
        name="view_shopping_list"
        options={{
          headerTitle: "Shopping List",
        }}
      />
      <Stack.Screen
        name="new_ingredient"
        options={{
          headerTitle: "Add new ingredient",
        }}
      />
      <Stack.Screen
        name="new_shopping_list"
        options={{
          headerTitle: "Create new shopping list",
        }}
      />
    </Stack>
  )
}
