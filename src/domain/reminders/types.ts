export type ReminderStatus = "upcoming" | "dueSoon" | "due" | "overdue";

export interface ReminderCheckResult {
  reminderId: string;
  isTriggered: boolean;
  status: ReminderStatus;
  triggerReason: "date" | "mileage" | "both" | null;
  daysRemaining: number | null;
  kmRemaining: number | null;
  messages: string[]; // List of messages corresponding to offsets hit
}
