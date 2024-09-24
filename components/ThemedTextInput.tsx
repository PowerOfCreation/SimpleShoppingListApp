import { useThemeColor } from "@/hooks/useThemeColor"
import { StyleSheet, TextInput } from "react-native"
import React from "react"

export type ThemedTextInput = {
  onChangeText: (text: string) => void
  onSubmit: (text: string) => void
  onBlur?: () => void
  value: string
  placeholder: string
  borderColor?: string
  autoFocus?: boolean
}

export function ThemedTextInput({
  autoFocus = false, // Default value of false
  ...props
}: ThemedTextInput) {
  const defaultBorderColor = useThemeColor({}, "text")

  const colorStyles = {
    borderColor: props.borderColor ?? defaultBorderColor,
    color: useThemeColor({}, "text"),
  }

  return (
    <TextInput
      style={[styles.input, colorStyles]}
      onChangeText={props.onChangeText}
      onBlur={props.onBlur}
      value={props.value}
      placeholder={props.placeholder}
      placeholderTextColor={useThemeColor({}, "icon")}
      onSubmitEditing={(event) => props.onSubmit(event.nativeEvent.text)}
      autoFocus={autoFocus}
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
