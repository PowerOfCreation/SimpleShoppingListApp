import {
  Modal,
  Pressable,
  View,
  StyleSheet,
  KeyboardAvoidingView,
  TextInput,
} from "react-native"
import React from "react"
import { ThemedText } from "./ThemedText"
import { ThemedTextInput } from "./ThemedTextInput"
import { useThemeColor } from "@/hooks/useThemeColor"
import { Palette } from "@/constants/Colors"

export type RenameSheetProps = {
  visible: boolean
  initialValue: string
  onClose: () => void
  onSave: (name: string) => void
  testID?: string
}

export function RenameSheet(props: RenameSheetProps) {
  const [text, setText] = React.useState(props.initialValue)
  const inputRef = React.useRef<TextInput>(null)

  React.useEffect(() => {
    if (props.visible) {
      setText(props.initialValue)
    }
  }, [props.visible, props.initialValue])

  const surfaceColor = useThemeColor({}, "surface")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")

  const testIDPrefix = props.testID ?? "rename-sheet"

  const handleSave = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    props.onSave(trimmed)
    props.onClose()
  }

  return (
    <Modal
      testID={props.testID}
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
      onShow={() => {
        // We don't know exactly when the input is ready to receive focus, so we wait a bit before focusing.
        setTimeout(() => {
          inputRef.current?.focus()
        }, 100)
      }}
    >
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <Pressable
          testID={props.testID ? `${props.testID}-scrim` : undefined}
          style={StyleSheet.absoluteFill}
          onPress={props.onClose}
        />
        <View style={[styles.sheet, { backgroundColor: surfaceColor }]}>
          <View
            style={[styles.handle, { backgroundColor: textSecondaryColor }]}
          />
          <ThemedText style={styles.title} type="defaultSemiBold">
            Rename
          </ThemedText>
          <View style={styles.inputContainer}>
            <ThemedTextInput
              testID={`${testIDPrefix}-input`}
              ref={inputRef}
              value={text}
              onChangeText={setText}
              onSubmit={handleSave}
              placeholder=""
              borderColor={accentColor}
              selectTextOnFocus
            />
          </View>
          <View style={styles.actions}>
            <Pressable
              testID={`${testIDPrefix}-cancel`}
              style={styles.actionButton}
              onPress={props.onClose}
            >
              <ThemedText
                style={[styles.actionText, { color: textSecondaryColor }]}
              >
                Cancel
              </ThemedText>
            </Pressable>
            <Pressable
              testID={`${testIDPrefix}-save`}
              style={[styles.actionButton, { backgroundColor: accentColor }]}
              onPress={handleSave}
            >
              <ThemedText style={[styles.actionText, { color: onAccentColor }]}>
                Save
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: Palette.overlay,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 22,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
    marginTop: 10,
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    marginTop: 8,
  },
  inputContainer: {
    flexDirection: "row",
    marginTop: 10,
    marginBottom: 6,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 8,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "700",
  },
})
