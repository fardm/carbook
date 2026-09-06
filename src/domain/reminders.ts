import {
  addDays,
  addMonths,
  compareIso,
  diffDays,
  isValidIso,
  todayIso,
} from "./calendar";
import type { NotificationOffset, Reminder } from "./types";

/**
 * Reminder engine (Phases 9–13): pure date/mileage logic over the persisted
 * Reminder facts. No DOM, no storage — views and the checker call into this
 * module only, so all arithmetic is unit-testable.
 *
 * Dates are Gregorian ISO "yyyy-mm-dd" (machine-readable, calendar-agnostic
 * storage); the calendar preference only changes DISPLAY elsewhere. All the
 * date arithmetic reuses domain/calendar (no duplicate date utilities).
 */

/** Remaining days until the date condition (negative = past). */
export function remainingDays(reminder: Reminder, today: string = todayIso()): number | null {
  if (reminder.dueDate == null) return null;
  return diffDays(reminder.dueDate, today);
}

/** Remaining km until the mileage condition (negative = past). */
export function remainingKm(reminder: Reminder, currentOdometer: number | null): number | null {
  if (reminder.dueMileage == null || currentOdometer == null) return null;
  return reminder.dueMileage - currentOdometer;
}

/** Derived status of one reminder (§14-style bands + disabled). */
export type ReminderStatus =
  | "upcoming"
  | "dueSoon"
  | "dueToday"
  | "due"
  | "overdue"
  | "disabled";

/** Status + both remaining metrics in one derived snapshot (never persisted). */
export interface ReminderEvaluation {
  status: ReminderStatus;
  days: number | null;
  km: number | null;
}

/**
 * "Due soon" window: at/below this many remaining days (or km) a reminder
 * shows as dueSoon. Bands mirror the maintenance engine's due-soon concept;
 * the maintenance thresholds themselves are %-based and don't apply here.
 */
export const DUE_SOON_DAYS = 7;
export const DUE_SOON_KM = 500;

/** Which side of a date_mileage reminder will fire first. */
export type ReminderPrimary = "date" | "mileage";

/** Urgency ranking (lower = more urgent). */
const URGENCY: ReminderStatus[] = ["overdue", "due", "dueToday", "dueSoon", "upcoming"];

/**
 * Evaluates one reminder against today/current mileage. `today` is
 * injectable for deterministic tests. date_mileage fires on whichever
 * condition comes first, so the status is the more urgent of the two.
 * Disabled reminders keep their raw metrics but report "disabled".
 */
export function evaluateReminder(
  reminder: Reminder,
  currentOdometer: number | null,
  today: string = todayIso(),
): ReminderEvaluation {
  const days = remainingDays(reminder, today);
  const km = remainingKm(reminder, currentOdometer);
  if (!reminder.enabled) return { status: "disabled", days, km };

  const statuses = [dateConditionStatus(days), mileageConditionStatus(km)].filter(
    (status): status is ReminderStatus => status != null,
  );
  if (statuses.length === 0) return { status: "upcoming", days, km };
  const status = statuses.reduce((worst, candidate) =>
    URGENCY.indexOf(candidate) < URGENCY.indexOf(worst) ? candidate : worst,
  );
  return { status, days, km };
}

/** Status of the date condition alone; null when the reminder has no date. */
function dateConditionStatus(days: number | null): ReminderStatus | null {
  if (days == null) return null;
  if (days < 0) return "overdue";
  if (days === 0) return "dueToday";
  if (days <= DUE_SOON_DAYS) return "dueSoon";
  return "upcoming";
}

/** Status of the mileage condition alone; null when not computable. */
function mileageConditionStatus(km: number | null): ReminderStatus | null {
  if (km == null) return null;
  if (km < 0) return "overdue";
  if (km === 0) return "due";
  if (km <= DUE_SOON_KM) return "dueSoon";
  return "upcoming";
}

/**
 * The condition that will fire first (date_mileage display: "۶ ماه یا
 * ۱۰٬۰۰۰ کیلومتر"). Null when only one/none is measurable.
 */
export function closestCondition(
  reminder: Reminder,
  currentOdometer: number | null,
  today: string = todayIso(),
): ReminderPrimary | null {
  const days = remainingDays(reminder, today);
  const km = remainingKm(reminder, currentOdometer);
  if (days == null && km == null) return null;
  if (days == null) return "mileage";
  if (km == null) return "date";
  // Normalized against the due-soon bands so the two scales are comparable.
  return Math.abs(days) / DUE_SOON_DAYS <= Math.abs(km) / DUE_SOON_KM ? "date" : "mileage";
}

/**
 * Notification thresholds already reached right now: every offset whose
 * lead condition has arrived. Offsets with `days` apply to date conditions
 * (days BEFORE the due date); offsets with `km` to mileage conditions (km
 * BEFORE the due mileage). Returns the MATCHED offsets so the checker can
 * dedupe per (reminder, offset, occurrence) and never re-notify.
 */
export function triggeredOffsets(
  reminder: Reminder,
  currentOdometer: number | null,
  today: string = todayIso(),
): NotificationOffset[] {
  if (!reminder.enabled) return [];
  const matched: NotificationOffset[] = [];
  const watchesDate = reminder.type === "date" || reminder.type === "date_mileage";
  const watchesKm = reminder.type === "mileage" || reminder.type === "date_mileage";

  for (const offset of reminder.notificationOffsets) {
    if (offset.days != null && watchesDate && reminder.dueDate != null) {
      const triggerDate = addDays(reminder.dueDate, -offset.days);
      // trigger <= today → the lead window has opened (due day included).
      if (compareIso(triggerDate, today) <= 0) matched.push(offset);
    }
    if (offset.km != null && watchesKm && reminder.dueMileage != null && currentOdometer != null) {
      const triggerKm = reminder.dueMileage - offset.km;
      if (currentOdometer >= triggerKm) matched.push(offset);
    }
  }
  return matched;
}

/** Stable key for one offset (dedupe state), e.g. "d7" / "k500". */
export function offsetKey(offset: NotificationOffset): string {
  if (offset.days != null) return `d${offset.days}`;
  if (offset.km != null) return `k${offset.km}`;
  return "?";
}

/**
 * Whether the CURRENT occurrence is fully due (the actual due date/mileage
 * reached — not just an offset threshold). Used by the checker for the
 * due-notification and before rolling recurrence forward.
 */
export function isDue(reminder: Reminder, currentOdometer: number | null, today: string = todayIso()): boolean {
  if (!reminder.enabled) return false;
  const watchesDate = reminder.type === "date" || reminder.type === "date_mileage";
  const watchesKm = reminder.type === "mileage" || reminder.type === "date_mileage";
  if (watchesDate && reminder.dueDate != null && compareIso(reminder.dueDate, today) <= 0) return true;
  if (
    watchesKm &&
    reminder.dueMileage != null &&
    currentOdometer != null &&
    currentOdometer >= reminder.dueMileage
  ) {
    return true;
  }
  return false;
}

/**
 * Which condition(s) of the current occurrence are actually due. A
 * date_mileage reminder can roll forward when EITHER side completes; the
 * other condition's due value re-bases onto the new occurrence.
 */
export type DueSides = { date: boolean; mileage: boolean };

export function dueSides(reminder: Reminder, currentOdometer: number | null, today: string = todayIso()): DueSides {
  const watchesDate = reminder.type === "date" || reminder.type === "date_mileage";
  const watchesKm = reminder.type === "mileage" || reminder.type === "date_mileage";
  return {
    date: watchesDate && reminder.dueDate != null && compareIso(reminder.dueDate, today) <= 0,
    mileage:
      watchesKm &&
      reminder.dueMileage != null &&
      currentOdometer != null &&
      currentOdometer >= reminder.dueMileage,
  };
}

/**
 * The next occurrence for a recurring reminder, computed from its LAST
 * COMPLETED facts (never the current due values, so identity/history is
 * preserved and no duplicate record is created). Returns the new due
 * fields, or null when the reminder does not recur or cannot advance.
 */
export function nextOccurrence(
  reminder: Reminder,
  completedDate: string,
  completedMileage: number | null,
): { dueDate: string | null; dueMileage: number | null } | null {
  switch (reminder.repeat) {
    case "monthly":
      if (reminder.type === "mileage") return null;
      return { dueDate: addMonths(completedDate, 1), dueMileage: reminder.dueMileage };
    case "yearly":
      if (reminder.type === "mileage") return null;
      return { dueDate: addMonths(completedDate, 12), dueMileage: reminder.dueMileage };
    case "km": {
      const step = reminder.repeatEveryKm;
      if (step == null || step <= 0 || reminder.type === "date") return null;
      // Base: the last completed odometer when known, otherwise step back
      // from the old due mileage (first roll-over before any completion).
      const base =
        completedMileage ?? (reminder.dueMileage != null ? reminder.dueMileage - step : null);
      if (base == null) return null;
      return { dueDate: reminder.dueDate, dueMileage: base + step };
    }
    default:
      return null;
  }
}

/** Sort helper: most urgent first (overdue → due → dueToday → dueSoon → upcoming → disabled). */
export function compareReminderEvaluations(a: ReminderEvaluation, b: ReminderEvaluation): number {
  return URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status);
}

/* --- Form draft validation (Phase 5) — pure, mirrors records.ts --- */

export interface ReminderDraft {
  vehicleId: string;
  title: string;
  description: string;
  serviceId: string | null;
  type: Reminder["type"];
  dueDate: string | null;
  dueMileage: number | null;
  notificationOffsets: NotificationOffset[];
  repeat: Reminder["repeat"];
  repeatEveryKm: number | null;
  enabled: boolean;
}

export type ReminderDraftError =
  | "titleRequired"
  | "dueDateRequired"
  | "dueDateInvalid"
  | "dueMileageRequired"
  | "dueMileageInvalid"
  | "conditionRequired"
  | "repeatKmRequired"
  | "repeatKmInvalid"
  | "offsetInvalid";

/** Validates a reminder draft; empty result = valid (same pattern as records.ts). */
export function validateReminderDraft(draft: ReminderDraft): ReminderDraftError[] {
  const errors: ReminderDraftError[] = [];

  if (draft.title.trim() === "") errors.push("titleRequired");

  const watchesDate = draft.type === "date" || draft.type === "date_mileage";
  const watchesKm = draft.type === "mileage" || draft.type === "date_mileage";

  if (watchesDate) {
    if (draft.dueDate == null || draft.dueDate === "") errors.push("dueDateRequired");
    else if (!isValidIso(draft.dueDate)) errors.push("dueDateInvalid");
  }
  if (watchesKm) {
    if (draft.dueMileage == null) errors.push("dueMileageRequired");
    else if (!Number.isInteger(draft.dueMileage) || draft.dueMileage < 0) {
      errors.push("dueMileageInvalid");
    }
  }
  if (!watchesDate && !watchesKm) errors.push("conditionRequired");

  if (draft.repeat === "km" && draft.repeatEveryKm == null) errors.push("repeatKmRequired");
  if (
    draft.repeat === "km" &&
    draft.repeatEveryKm != null &&
    (!Number.isInteger(draft.repeatEveryKm) || draft.repeatEveryKm <= 0)
  ) {
    errors.push("repeatKmInvalid");
  }

  const usableOffsets = draft.notificationOffsets.filter(
    (offset) =>
      (offset.days != null && Number.isInteger(offset.days) && offset.days >= 0) ||
      (offset.km != null && Number.isInteger(offset.km) && offset.km >= 0),
  );
  if (usableOffsets.length !== draft.notificationOffsets.length) errors.push("offsetInvalid");

  return errors;
}
