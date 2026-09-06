import type { Reminder, Vehicle } from "../types";
import { diffDays, todayIso, addMonths } from "../calendar";
import type { ReminderCheckResult, ReminderStatus } from "./types";

export function checkReminder(reminder: Reminder, vehicle: Vehicle | undefined): ReminderCheckResult {
  if (!reminder.active) {
    return {
      reminderId: reminder.id,
      isTriggered: false,
      status: "upcoming",
      triggerReason: null,
      daysRemaining: null,
      kmRemaining: null,
      messages: []
    };
  }

  let daysRemaining: number | null = null;
  let kmRemaining: number | null = null;
  let isDateTriggered = false;
  let isMileageTriggered = false;
  const messages: string[] = [];

  const today = todayIso();

  if ((reminder.type === "date" || reminder.type === "both") && reminder.dueDate) {
    daysRemaining = diffDays(today, reminder.dueDate);
  }

  if ((reminder.type === "mileage" || reminder.type === "both") && reminder.dueMileage !== null && vehicle && vehicle.currentOdometer !== null) {
    kmRemaining = reminder.dueMileage - vehicle.currentOdometer;
  }

  // Check offsets
  for (const offset of reminder.notificationOffsets) {
    if (daysRemaining !== null && offset.daysBefore !== null) {
      if (daysRemaining <= offset.daysBefore) {
        isDateTriggered = true;
        if (daysRemaining < 0) {
           messages.push(`${Math.abs(daysRemaining)} days overdue`);
        } else if (daysRemaining === 0) {
           messages.push(`Due today`);
        } else {
           messages.push(`Due in ${daysRemaining} days`);
        }
      }
    }
    if (kmRemaining !== null && offset.kmBefore !== null) {
      if (kmRemaining <= offset.kmBefore) {
        isMileageTriggered = true;
        if (kmRemaining < 0) {
           messages.push(`${Math.abs(kmRemaining)} km overdue`);
        } else if (kmRemaining === 0) {
           messages.push(`Due now`);
        } else {
           messages.push(`Due in ${kmRemaining} km`);
        }
      }
    }
  }

  let triggerReason: ReminderCheckResult["triggerReason"] = null;
  if (isDateTriggered && isMileageTriggered) triggerReason = "both";
  else if (isDateTriggered) triggerReason = "date";
  else if (isMileageTriggered) triggerReason = "mileage";

  let status: ReminderStatus = "upcoming";
  if (isDateTriggered || isMileageTriggered) {
      status = "due";
      if ((daysRemaining !== null && daysRemaining < 0) || (kmRemaining !== null && kmRemaining < 0)) {
          status = "overdue";
      }
  } else {
     // rudimentary dueSoon check if not triggered but close
      if (daysRemaining !== null && daysRemaining <= 30) status = "dueSoon";
      if (kmRemaining !== null && kmRemaining <= 1000) status = "dueSoon";
  }

  return {
    reminderId: reminder.id,
    isTriggered: isDateTriggered || isMileageTriggered,
    status,
    triggerReason,
    daysRemaining,
    kmRemaining,
    messages
  };
}

export function calculateNextOccurrence(reminder: Reminder, _vehicle: Vehicle | undefined): Reminder {
  if (reminder.repeat === "none") return { ...reminder, active: false };

  let nextDueDate = reminder.dueDate;
  let nextDueMileage = reminder.dueMileage;

  if (reminder.repeat === "yearly" && nextDueDate) {
    nextDueDate = addMonths(nextDueDate, 12);
  } else if (reminder.repeat === "monthly" && nextDueDate) {
    nextDueDate = addMonths(nextDueDate, 1);
  } else if (reminder.repeat === "km" && nextDueMileage !== null && reminder.repeatKm !== null) {
    nextDueMileage += reminder.repeatKm;
  }

  return {
    ...reminder,
    dueDate: nextDueDate,
    dueMileage: nextDueMileage,
    lastNotifiedAt: null // reset notification state for next occurrence
  };
}
