import { Modal, Pressable, View, StyleSheet } from "react-native"
import React from "react"
import { ThemedText } from "./ThemedText"
import { useThemeColor } from "@/hooks/useThemeColor"
import { Palette } from "@/constants/Colors"
import { Priority } from "@/types/Priority"
import { formatPriority, PRIORITY_OPTIONS } from "@/utils/priority"

export type PriorityPickerProps = {
  visible: boolean
  title: string
  currentPriority?: Priority
  onClose: () => void
  onApply: (priority: Priority | undefined) => void
  testID?: string
}

export function PriorityPicker(props: PriorityPickerProps) {
  const [selected, setSelected] = React.useState<Priority | undefined>(
    props.currentPriority
  )

  React.useEffect(() => {
    if (props.visible) {
      setSelected(props.currentPriority)
    }
  }, [props.visible, props.currentPriority])

  const surfaceColor = useThemeColor({}, "surface")
  const dividerColor = useThemeColor({}, "divider")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")
  const priorityColors: Record<Priority, string> = {
    [Priority.NOW]: useThemeColor({}, "prioUrgent"),
    [Priority.DAYS_1_TO_3]: useThemeColor({}, "prio13"),
    [Priority.DAYS_4_PLUS]: useThemeColor({}, "prio4plus"),
  }

  const testIDPrefix = props.testID ?? "priority-picker"

  const renderRadio = (isSelected: boolean) => (
    <View
      style={[
        styles.radioOuter,
        { borderColor: isSelected ? accentColor : dividerColor },
      ]}
    >
      {isSelected && (
        <View style={[styles.radioInner, { backgroundColor: accentColor }]} />
      )}
    </View>
  )

  const renderOption = (option: Priority) => {
    const isSelected = selected === option
    return (
      <Pressable
        key={option}
        testID={`${testIDPrefix}-option-${option}`}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: dividerColor },
          pressed && styles.rowPressed,
        ]}
        android_ripple={{ color: dividerColor }}
        onPress={() => setSelected(option)}
      >
        <View
          style={[styles.pill, { backgroundColor: priorityColors[option] }]}
        >
          <ThemedText style={[styles.pillText, { color: onAccentColor }]}>
            {formatPriority(option)}
          </ThemedText>
        </View>
        {renderRadio(isSelected)}
      </Pressable>
    )
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
            Change priority
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: textSecondaryColor }]}>
            {props.title}
          </ThemedText>
          <View style={[styles.divider, { backgroundColor: dividerColor }]} />
          {PRIORITY_OPTIONS.map(renderOption)}
          <Pressable
            testID={`${testIDPrefix}-none`}
            style={({ pressed }) => [
              styles.row,
              styles.lastRow,
              pressed && styles.rowPressed,
            ]}
            android_ripple={{ color: dividerColor }}
            onPress={() => setSelected(undefined)}
          >
            <ThemedText style={{ color: textSecondaryColor }}>None</ThemedText>
            {renderRadio(selected === undefined)}
          </Pressable>
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
              testID={`${testIDPrefix}-apply`}
              style={[styles.actionButton, { backgroundColor: accentColor }]}
              onPress={() => {
                props.onApply(selected)
                props.onClose()
              }}
            >
              <ThemedText style={[styles.actionText, { color: onAccentColor }]}>
                Apply
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
  subtitle: {
    fontSize: 15,
    marginTop: 2,
    marginBottom: 10,
  },
  divider: {
    height: 1,
    marginHorizontal: -20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    opacity: 0.6,
  },
  pill: {
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
