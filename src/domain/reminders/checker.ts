import type { Dataset } from "../types";
import { checkReminder, calculateNextOccurrence } from "./logic";

export function checkAllReminders(dataset: Dataset): {
  notifications: Array<{ title: string; body: string; reminderId: string }>;
  mutatedDataset: Dataset | null; // null if no mutations needed (no state updates)
} {
  let needsMutation = false;
  const newDataset = structuredClone(dataset);
  const notifications: Array<{ title: string; body: string; reminderId: string }> = [];

  const now = new Date();
  // We use the start of the current day in local time as the boundary for "already notified today"
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  for (let i = 0; i < newDataset.reminders.length; i++) {
    const reminder = newDataset.reminders[i];
    if (!reminder.active) continue;

    const vehicle = newDataset.vehicles.find((v) => v.id === reminder.vehicleId);
    const result = checkReminder(reminder, vehicle);

    if (result.isTriggered && result.messages.length > 0) {
      // Check if we already notified today
      const alreadyNotifiedToday = reminder.lastNotifiedAt && reminder.lastNotifiedAt >= startOfDay;

      if (!alreadyNotifiedToday) {
        notifications.push({
          title: reminder.title,
          body: result.messages.join(", "),
          reminderId: reminder.id,
        });

        // Mutate the cloned reminder to mark it as notified
        newDataset.reminders[i].lastNotifiedAt = now.toISOString();
        needsMutation = true;

        const isActuallyDue = (result.daysRemaining !== null && result.daysRemaining <= 0) ||
                              (result.kmRemaining !== null && result.kmRemaining <= 0);

        if (isActuallyDue) {
            const nextOccur = calculateNextOccurrence(newDataset.reminders[i], vehicle);
            newDataset.reminders[i] = nextOccur;
            // It might still be triggered, but we already sent the notification for the current period
        }
      }
    }
  }

  return {
    notifications,
    mutatedDataset: needsMutation ? newDataset : null,
  };
}
