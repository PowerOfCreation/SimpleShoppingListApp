import { useThemeColor } from "@/hooks/useThemeColor"
import { StyleProp, StyleSheet, TextInput, TextStyle } from "react-native"
import React, { forwardRef, LegacyRef } from "react"

export type ThemedTextInputParams = {
  testID?: string
  onChangeText: (text: string) => void
  onSubmit: (text: string) => void
  onBlur?: () => void
  value: string
  placeholder: string
  borderColor?: string
  autoFocus?: boolean
  showSoftInputOnFocus?: boolean
  selectTextOnFocus?: boolean
  style?: StyleProp<TextStyle>
  ref?: LegacyRef<TextInput>
}

export const ThemedTextInput = forwardRef<TextInput, ThemedTextInputParams>(
  function ThemedTextInput(
    {
      autoFocus = false, // Default value of false
      showSoftInputOnFocus = true,
      selectTextOnFocus = false,
      ...props
    }: ThemedTextInputParams,
    ref
  ) {
    const defaultBorderColor = useThemeColor({}, "text")

    const colorStyles = {
      borderColor: props.borderColor ?? defaultBorderColor,
      color: useThemeColor({}, "text"),
    }

    return (
      <TextInput
        testID={props.testID}
        style={[styles.input, colorStyles, props.style]}
        onChangeText={props.onChangeText}
        onBlur={props.onBlur}
        value={props.value}
        placeholder={props.placeholder}
        placeholderTextColor={useThemeColor({}, "icon")}
        onSubmitEditing={() => props.onSubmit(props.value)}
        autoFocus={autoFocus}
        showSoftInputOnFocus={showSoftInputOnFocus}
        selectTextOnFocus={selectTextOnFocus}
        ref={ref}
      />
    )
  }
)

const styles = StyleSheet.create({
  input: {
    height: 40,
    borderWidth: 1.4,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
  },
})
