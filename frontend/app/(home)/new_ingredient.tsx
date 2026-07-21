import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import React from "react"
import { Pressable, View, StyleSheet, TextInput, FlatList } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ThemedText } from "@/components/ThemedText"
import { ThemedTextInput } from "@/components/ThemedTextInput"
import { Palette } from "@/constants/Colors"
import { useThemeColor } from "@/hooks/useThemeColor"
import { ingredientService } from "@/api/ingredient-service"
import { useCompletedIngredients } from "@/hooks/useCompletedIngredients"
import { Ingredient } from "@/types/Ingredient"
import { Priority } from "@/types/Priority"
import { formatPriority, PRIORITY_OPTIONS } from "@/utils/priority"

export default function NewIngredient() {
  const { listId } = useLocalSearchParams<{ listId: string }>()
  const [text, onChangeText] = React.useState("")
  const [invalidInputExplanation, setInvalidInputExplanation] =
    React.useState("")
  const [priority, setPriority] = React.useState<Priority | undefined>(
    undefined
  )
  const [showPriorityPicker, setShowPriorityPicker] = React.useState(false)
  const inputRef = React.useRef<TextInput>(null)

  const dividerColor = useThemeColor({}, "divider")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")
  const priorityColors: Record<Priority, string> = {
    [Priority.NOW]: useThemeColor({}, "prioUrgent"),
    [Priority.DAYS_1_TO_3]: useThemeColor({}, "prio13"),
    [Priority.DAYS_4_PLUS]: useThemeColor({}, "prio4plus"),
  }

  const { completedIngredients } = useCompletedIngredients(listId)

  // Filter completed ingredients based on user input
  const filteredCompletedIngredients = React.useMemo(() => {
    const searchText = text.trim().toLowerCase()
    if (!searchText) {
      return completedIngredients
    }
    return completedIngredients.filter((ingredient) =>
      ingredient.name.toLowerCase().includes(searchText)
    )
  }, [text, completedIngredients])

  useFocusEffect(
    React.useCallback(() => {
      const id = setTimeout(() => {
        inputRef.current?.focus()
      }, 100) // we don't know when page is fully loaded on android, so we just wait a bit before focusing
      return () => clearTimeout(id)
    }, [])
  )

  const addIngredient = async (ingredientName: string) => {
    if (!listId) {
      setInvalidInputExplanation("No list selected")
      return
    }
    const result = await ingredientService.AddIngredients(
      ingredientName,
      listId
    )

    if (!result.success) {
      const error = result.getError()
      setInvalidInputExplanation(error.message)
      return
    }

    if (priority !== undefined) {
      await ingredientService.setPriority(result.getValue()!.id, priority)
    }

    onChangeText("")
    setPriority(undefined)
    setShowPriorityPicker(false)
    router.back()
  }

  if (invalidInputExplanation && text.trim()) {
    setInvalidInputExplanation("")
  }

  const renderCompletedIngredient = ({ item }: { item: Ingredient }) => (
    <Pressable
      style={[
        styles.completedIngredientItem,
        { borderBottomColor: dividerColor },
      ]}
      onPress={() => {
        onChangeText(item.name)
        inputRef.current?.focus()
      }}
    >
      <ThemedText style={styles.completedIngredientName}>
        {item.name}
      </ThemedText>
    </Pressable>
  )

  const renderPriorityOption = (option: Priority) => {
    const selected = priority === option
    return (
      <Pressable
        key={option}
        onPress={() => setPriority(selected ? undefined : option)}
        style={[
          styles.priorityPill,
          selected
            ? { backgroundColor: priorityColors[option] }
            : { borderWidth: 1.4, borderColor: dividerColor },
        ]}
      >
        <ThemedText
          style={[
            styles.priorityPillText,
            { color: selected ? onAccentColor : textSecondaryColor },
          ]}
        >
          {formatPriority(option)}
        </ThemedText>
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={styles.containerStyle}>
      <View style={styles.searchBarContainer}>
        <ThemedTextInput
          ref={inputRef}
          onSubmit={() => addIngredient(text)}
          onChangeText={onChangeText}
          value={text}
          placeholder="Ingredient name"
          borderColor={invalidInputExplanation ? "red" : undefined}
        />

        <Pressable
          style={styles.buttonStyle}
          onPress={() => addIngredient(text)}
        >
          <ThemedText style={{ color: accentColor, fontWeight: "600" }}>
            Add
          </ThemedText>
        </Pressable>
      </View>
      {invalidInputExplanation ? (
        <ThemedText style={styles.invalidInputExplanationStyle}>
          {invalidInputExplanation}
        </ThemedText>
      ) : null}

      {showPriorityPicker ? (
        <View style={styles.priorityContainer}>
          <ThemedText
            style={[styles.sectionLabel, { color: textSecondaryColor }]}
          >
            Priority (optional)
          </ThemedText>
          <View style={styles.priorityOptions}>
            {PRIORITY_OPTIONS.map(renderPriorityOption)}
          </View>
        </View>
      ) : (
        <Pressable
          style={styles.priorityContainer}
          onPress={() => setShowPriorityPicker(true)}
        >
          <ThemedText style={{ color: accentColor, fontSize: 13 }}>
            + Add priority (optional)
          </ThemedText>
        </Pressable>
      )}

      {filteredCompletedIngredients.length > 0 && (
        <View style={styles.completedIngredientsContainer}>
          <ThemedText
            style={[
              styles.completedIngredientsHeader,
              { color: textSecondaryColor },
            ]}
          >
            Previously completed
          </ThemedText>
          <FlatList
            data={filteredCompletedIngredients}
            renderItem={renderCompletedIngredient}
            keyExtractor={(item) => item.id}
            style={styles.completedIngredientsList}
          />
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  searchBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 16,
    width: "100%",
  },
  containerStyle: {
    flex: 1,
  },
  buttonStyle: {
    paddingHorizontal: 4,
  },
  invalidInputExplanationStyle: {
    color: Palette.error,
    paddingHorizontal: 18,
    marginTop: 8,
  },
  priorityContainer: {
    paddingHorizontal: 18,
    marginTop: 18,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  priorityOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  priorityPill: {
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  priorityPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  completedIngredientsContainer: {
    flex: 1,
    width: "100%",
    marginTop: 20,
    paddingHorizontal: 18,
  },
  completedIngredientsHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  completedIngredientsList: {
    flex: 1,
  },
  completedIngredientItem: {
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  completedIngredientName: {
    fontSize: 14,
  },
})
