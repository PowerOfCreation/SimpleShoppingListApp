import { Modal, Pressable, View, StyleSheet } from "react-native"
import { ThemedText } from "./ThemedText"
import { useThemeColor } from "@/hooks/useThemeColor"

export type ConfirmDialogProps = {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
  testID?: string
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const surfaceColor = useThemeColor({}, "surface")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")
  const dangerColor = useThemeColor({}, "danger")

  const testIDPrefix = props.testID ?? "confirm-dialog"

  const handleConfirm = () => {
    props.onConfirm()
    props.onClose()
  }

  return (
    <Modal
      testID={props.testID}
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <View style={styles.overlay}>
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
            {props.title}
          </ThemedText>
          <ThemedText style={[styles.message, { color: textSecondaryColor }]}>
            {props.message}
          </ThemedText>
          <View style={styles.actions}>
            <Pressable
              testID={`${testIDPrefix}-cancel`}
              style={styles.actionButton}
              onPress={props.onClose}
            >
              <ThemedText
                style={[styles.actionText, { color: textSecondaryColor }]}
              >
                {props.cancelLabel ?? "Cancel"}
              </ThemedText>
            </Pressable>
            <Pressable
              testID={`${testIDPrefix}-confirm`}
              style={[
                styles.actionButton,
                {
                  backgroundColor: props.destructive
                    ? dangerColor
                    : accentColor,
                },
              ]}
              onPress={handleConfirm}
            >
              <ThemedText style={[styles.actionText, { color: onAccentColor }]}>
                {props.confirmLabel}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
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
  message: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 14,
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
