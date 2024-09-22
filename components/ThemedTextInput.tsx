import { useThemeColor } from "@/hooks/useThemeColor"
import { StyleSheet, TextInput } from "react-native"
import React from "react"

export type ThemedTextInput = {
  onChangeText: (text: string) => void
  onSubmit: (text: string) => void
  value: string
  placeholder: string
  borderColor?: string
}

export function ThemedTextInput(params: ThemedTextInput) {
  const defaultBorderColor = useThemeColor({}, "text")

  const colorStyles = {
    borderColor: params.borderColor ?? defaultBorderColor,
    color: useThemeColor({}, "text"),
  }

  return (
    <TextInput
      style={[styles.input, colorStyles]}
      onChangeText={params.onChangeText}
      value={params.value}
      placeholder={params.placeholder}
      placeholderTextColor={useThemeColor({}, "icon")}
      onSubmitEditing={(event) => params.onSubmit(event.nativeEvent.text)}
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
