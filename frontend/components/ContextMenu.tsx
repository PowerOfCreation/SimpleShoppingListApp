import { Modal, Pressable, View, StyleSheet } from "react-native"
import { ThemedText } from "./ThemedText"
import { useThemeColor } from "@/hooks/useThemeColor"
import { Palette } from "@/constants/Colors"

export type ContextMenuOption = {
  label: string
  onPress: () => void
  destructive?: boolean
  testID?: string
}

export type ContextMenuProps = {
  visible: boolean
  title: string
  onClose: () => void
  options: ContextMenuOption[]
  testID?: string
}

export function ContextMenu(props: ContextMenuProps) {
  const surfaceColor = useThemeColor({}, "surface")
  const dividerColor = useThemeColor({}, "divider")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")

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
          <ThemedText
            style={[styles.title, { color: textSecondaryColor }]}
            type="default"
          >
            {props.title}
          </ThemedText>
          <View style={[styles.divider, { backgroundColor: dividerColor }]} />
          {props.options.map((option, index) => (
            <Pressable
              key={option.label}
              testID={option.testID}
              style={[
                styles.option,
                index < props.options.length - 1 && [
                  styles.optionBorder,
                  { borderBottomColor: dividerColor },
                ],
              ]}
              onPress={() => {
                props.onClose()
                option.onPress()
              }}
            >
              <ThemedText
                style={option.destructive ? { color: dangerColor } : undefined}
                type="defaultSemiBold"
              >
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>
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
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  divider: {
    height: 1,
  },
  option: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  optionBorder: {
    borderBottomWidth: 1,
  },
})
