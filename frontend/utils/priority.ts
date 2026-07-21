import { Priority } from "@/types/Priority"

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
