import React, { useState } from "react"
import {
  FlatList,
  StyleSheet,
  ActivityIndicator,
  View,
  TouchableOpacity,
  ScrollView,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "expo-router"

import { DomainEventRow } from "@/types/DomainEvent"
import { ThemedText } from "@/components/ThemedText"
import { ThemedView } from "@/components/ThemedView"
import { useEvents } from "@/hooks/useEvents"
import { useThemeColor } from "@/hooks/useThemeColor"

const EVENT_TYPE_COLORS: Record<string, string> = {
  "todo_list.created": "#4CAF50",
}

function getEventColor(eventType: string): string {
  return EVENT_TYPE_COLORS[eventType] ?? "#9E9E9E"
}

function formatTimestamp(unixMs: number): string {
  const date = new Date(unixMs)
  return date.toLocaleString()
}

function EventCard({ event }: { event: DomainEventRow }) {
  const [expanded, setExpanded] = useState(false)
  const borderColor = getEventColor(event.event_type)
  const subtextColor = useThemeColor({}, "icon")

  let parsedPayload: unknown = null
  try {
    parsedPayload = JSON.parse(event.payload)
  } catch {
    parsedPayload = event.payload
  }

  return (
    <TouchableOpacity
      onPress={() => setExpanded((v) => !v)}
      activeOpacity={0.8}
    >
      <ThemedView style={[styles.card, { borderLeftColor: borderColor }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.badge, { backgroundColor: borderColor }]}>
            <ThemedText style={styles.badgeText}>{event.event_type}</ThemedText>
          </View>
          <ThemedText style={[styles.timestamp, { color: subtextColor }]}>
            {formatTimestamp(event.occurred_at)}
          </ThemedText>
        </View>

        <View style={styles.cardBody}>
          <ThemedText style={[styles.metaLabel, { color: subtextColor }]}>
            Aggregate
          </ThemedText>
          <ThemedText style={styles.metaValue} numberOfLines={1}>
            {event.aggregate_type} · {event.aggregate_id}
          </ThemedText>

          <ThemedText style={[styles.metaLabel, { color: subtextColor }]}>
            Client
          </ThemedText>
          <ThemedText style={styles.metaValue} numberOfLines={1}>
            {event.client_id}
          </ThemedText>
        </View>

        {expanded && (
          <View style={styles.payloadContainer}>
            <ThemedText style={[styles.metaLabel, { color: subtextColor }]}>
              Payload
            </ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <ThemedText style={styles.payloadText}>
                {JSON.stringify(parsedPayload, null, 2)}
              </ThemedText>
            </ScrollView>
          </View>
        )}

        <ThemedText style={[styles.expandHint, { color: subtextColor }]}>
          {expanded ? "Tippen zum Einklappen" : "Tippen für Payload"}
        </ThemedText>
      </ThemedView>
    </TouchableOpacity>
  )
}

export default function EventLogScreen() {
  const { events, isLoading, error, refetch } = useEvents()

  useFocusEffect(
    React.useCallback(() => {
      refetch()
    }, [refetch])
  )

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" accessibilityHint="loading events" />
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <ThemedText style={styles.errorText}>{error}</ThemedText>
      </View>
    )
  }

  if (events.length === 0) {
    return (
      <View style={styles.centered}>
        <ThemedText style={styles.emptyText}>
          Noch keine Events vorhanden.
        </ThemedText>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.summary}>
        <ThemedText style={styles.summaryText}>
          {events.length} Event{events.length !== 1 ? "s" : ""} gesamt
        </ThemedText>
      </View>
      <FlatList
        data={events}
        keyExtractor={(item) => item.event_id}
        renderItem={({ item }) => <EventCard event={item} />}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  summary: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  summaryText: {
    fontSize: 13,
    opacity: 0.6,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    borderRadius: 10,
    borderLeftWidth: 4,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  timestamp: {
    fontSize: 12,
  },
  cardBody: {
    gap: 2,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
  },
  metaValue: {
    fontSize: 13,
  },
  payloadContainer: {
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ccc",
    paddingTop: 8,
  },
  payloadText: {
    fontFamily: "monospace",
    fontSize: 12,
  },
  expandHint: {
    fontSize: 11,
    marginTop: 10,
    textAlign: "right",
  },
  errorText: {
    color: "red",
    textAlign: "center",
  },
  emptyText: {
    textAlign: "center",
    opacity: 0.6,
  },
})
