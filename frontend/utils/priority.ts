import { Priority } from "@/types/Priority"
import { Colors } from "@/constants/Colors"

export function formatPriority(priority: Priority): string {
  switch (priority) {
    case Priority.NOW:
      return "Now"
    case Priority.DAYS_1_TO_3:
      return "1-3 days"
    case Priority.DAYS_4_PLUS:
      return "4+ days"
  }
}

export function priorityColorKey(
  priority: Priority
): keyof typeof Colors.light {
  switch (priority) {
    case Priority.NOW:
      return "prioUrgent"
    case Priority.DAYS_1_TO_3:
      return "prio13"
    case Priority.DAYS_4_PLUS:
      return "prio4plus"
  }
}

export const PRIORITY_OPTIONS: Priority[] = [
  Priority.NOW,
  Priority.DAYS_1_TO_3,
  Priority.DAYS_4_PLUS,
]
