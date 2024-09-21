import { useThemeColor } from "@/hooks/useThemeColor"
import { StyleSheet, TextInput } from "react-native"

export type ThemedTextInput = {
  onChangeText: (text: string) => void
  value: string
  placeholder: string
}

export function ThemedTextInput(params: ThemedTextInput) {
  const color = {
    borderColor: useThemeColor({}, "text"),
    color: useThemeColor({}, "text"),
  }

  return (
    <TextInput
      style={[styles.input, color]}
      onChangeText={params.onChangeText}
      value={params.value}
      placeholder={params.placeholder}
      placeholderTextColor={useThemeColor({}, "icon")}
    />
  )
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    top: 0,
    height: 40,
    margin: 12,
    borderWidth: 1,
    padding: 10,
  },
})
