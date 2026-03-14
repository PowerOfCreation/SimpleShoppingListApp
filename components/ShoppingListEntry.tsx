import {
  GestureResponderEvent,
  TouchableOpacity,
  StyleSheet,
  TextInput,
} from "react-native"
import { ThemedText } from "./ThemedText"
import React, { forwardRef } from "react"
import { ThemedTextInput } from "./ThemedTextInput"

export type ShoppingListEntryProps = {
  id: string
  listName: string
  createdAt: number
  onPress: (event: GestureResponderEvent) => void
  onLongPress: (event: GestureResponderEvent) => void
  onPressOut?: (event: GestureResponderEvent) => void
  isEdited: boolean
  onCancelEditing: () => void
  onSaveEditing: (text: string) => void
}

export const ShoppingListEntry = forwardRef<TextInput, ShoppingListEntryProps>(
  function ShoppingListEntry(props: ShoppingListEntryProps, ref) {
    const [text, onChangeText] = React.useState(props.listName)

    React.useEffect(() => {
      onChangeText(props.listName)
    }, [props.isEdited, props.listName])

    return (
      <TouchableOpacity
        testID={`shopping-list-entry-${props.id}`}
        style={styles.listItem}
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        onPressOut={props.onPressOut}
      >
        {props.isEdited ? (
          <ThemedTextInput
            testID={`shopping-list-input-${props.id}`}
            onChangeText={onChangeText}
            onSubmit={props.onSaveEditing}
            value={text}
            placeholder={""}
            autoFocus={true}
            onBlur={props.onCancelEditing}
            ref={ref}
          />
        ) : (
          <>
            <ThemedText type="default">{props.listName}</ThemedText>
            <ThemedText style={styles.listDate} type="default">
              {new Date(props.createdAt).toLocaleDateString()}
            </ThemedText>
          </>
        )}
      </TouchableOpacity>
    )
  }
)

const styles = StyleSheet.create({
  listItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  listDate: {
    fontSize: 12,
    marginTop: 4,
    opacity: 0.6,
  },
})
