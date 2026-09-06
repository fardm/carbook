import { triggeredOffsets, offsetKey, nextOccurrence, dueSides } from "../domain/reminders";
import type { Dataset, Reminder } from "../domain/types";

/**
 * Centralized reminder checker (Phase 13).
 *
 * ONE entry point — runReminderCheck() — is called when the app starts,
 * becomes active again, a reminder is created/edited, or a vehicle's
 * mileage changes. It decides which browser notifications to fire and
 * returns the result; recurrence roll-over happens in a separate draft
 * pass (advanceRecurringReminders) so store.update() stays the only writer.
 *
 * Duplicate prevention: fired notifications are persisted under a SEPARATE
 * localStorage key (not inside the user-data envelope) as
 * `${reminderId}|${occurrenceKey}|${offsetKey}` → the ISO date it fired on.
 * Opening/refreshing the app again re-runs the check but every already-
 * notified threshold is skipped, so no notification ever repeats — state
 * does NOT rely on the current time alone.
 */

const CHECK_STATE_KEY = "car-maintenance-tracker.reminder-check-state";

interface CheckState {
  /** `${reminderId}|${occurrenceKey}|${offsetKey}` → ISO date fired. */
  notified: Record<string, string>;
}

function readCheckState(): CheckState {
  try {
    const raw = globalThis.localStorage?.getItem(CHECK_STATE_KEY);
    if (!raw) return { notified: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "notified" in parsed) {
      const notified = (parsed as { notified: unknown }).notified;
      if (typeof notified === "object" && notified !== null) {
        return { notified: notified as Record<string, string> };
      }
    }
  } catch {
    // Corrupt state must never break the app — start clean.
  }
  return { notified: {} };
}

function writeCheckState(state: CheckState): void {
  try {
    globalThis.localStorage?.setItem(CHECK_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/unavailable: notifications still work this session.
  }
}

/**
 * Identifies WHICH occurrence of a recurring reminder the current due
 * values belong to, so repeating reminders notify again on their next
 * occurrence while the same occurrence never notifies twice. One-time
 * reminders key on the id alone.
 */
export function occurrenceKey(reminder: Reminder): string {
  if (reminder.repeat === "none") return "once";
  return `${reminder.dueDate ?? "-"}|${reminder.dueMileage ?? "-"}`;
}

export interface ReminderCheckResult {
  /** Notifications fired this run (title/body already composed). */
  fired: Array<{ key: string; title: string; body: string }>;
}

/** Whether the browser can show notifications at all. */
export function notificationsSupported(): boolean {
  return typeof globalThis.Notification !== "undefined";
}

/** The browser's actual permission state ("granted" | "denied" | "default"). */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return globalThis.Notification.permission;
}

/** Requests browser notification permission (call from a user gesture). */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await globalThis.Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Shows one browser notification (silently ignored when unavailable). */
function showBrowserNotification(title: string, body: string): void {
  if (!notificationsSupported() || globalThis.Notification.permission !== "granted") return;
  try {
    new globalThis.Notification(title, { body });
  } catch {
    // Some engines require the service-worker constructor; never crash.
  }
}

/** The vehicle's current odometer, or null when unknown. */
function odometerOf(dataset: Dataset, vehicleId: string): number | null {
  return dataset.vehicles.find((vehicle) => vehicle.id === vehicleId)?.currentOdometer ?? null;
}

/** Composes the Persian notification body for one reminder + lead. */
function notificationBody(reminder: Reminder, leadDays: number | null, leadKm: number | null): string {
  const parts: string[] = [];
  if (leadDays != null) parts.push(leadDays === 0 ? "امروز" : `${leadDays} روز دیگر`);
  if (leadKm != null) parts.push(leadKm === 0 ? "کیلومتر موعد" : `${leadKm} کیلومتر مانده`);
  const lead = parts.length > 0 ? ` (${parts.join("، ")})` : "";
  return `یادآوری: ${reminder.title}${lead}`;
}

/**
 * Runs the full check across every enabled reminder. `today` is injectable
 * for deterministic tests. Never throws — a failed check must not break
 * the calling flow (boot / visibilitychange / save / mileage update).
 */
export function runReminderCheck(
  dataset: Dataset,
  today: string = new Date().toISOString().slice(0, 10),
): ReminderCheckResult {
  const result: ReminderCheckResult = { fired: [] };
  let state: CheckState;
  try {
    state = readCheckState();
  } catch {
    return result;
  }

  for (const reminder of dataset.reminders) {
    if (!reminder.enabled) continue;
    const odometer = odometerOf(dataset, reminder.vehicleId);
    const occKey = occurrenceKey(reminder);

    // 1) Offset thresholds → lead notifications (each offset fires once
    //    per occurrence).
    for (const offset of triggeredOffsets(reminder, odometer, today)) {
      const key = `${reminder.id}|${occKey}|${offsetKey(offset)}`;
      if (state.notified[key] != null) continue; // already shown — never repeat
      const leadKm =
        offset.km != null && reminder.dueMileage != null && odometer != null
          ? Math.max(0, reminder.dueMileage - odometer)
          : null;
      result.fired.push({
        key,
        title: "کاربوک",
        body: notificationBody(reminder, offset.days ?? null, leadKm),
      });
      state.notified[key] = today;
    }

    // 2) Fully due → the due notification (its own dedupe slot).
    if (dueSides(reminder, odometer, today).date || dueSides(reminder, odometer, today).mileage) {
      const dueKey = `${reminder.id}|${occKey}|due`;
      if (state.notified[dueKey] == null) {
        result.fired.push({
          key: dueKey,
          title: "کاربوک",
          body: notificationBody(reminder, 0, 0),
        });
        state.notified[dueKey] = today;
      }
    }
  }

  // Fire AFTER dedupe evaluation, then persist the updated state so a
  // reload can never show the same notification again.
  if (result.fired.length > 0) {
    for (const notification of result.fired) {
      showBrowserNotification(notification.title, notification.body);
    }
    writeCheckState(state);
  }

  return result;
}

/**
 * Recurrence roll-over (Phase 12): advances every recurring reminder whose
 * current occurrence completed. Mutates the DRAFT in place (call inside
 * store.update), preserving the reminder's identity and stamping the
 * completed facts for the next roll. Returns the ids rolled.
 */
export function advanceRecurringReminders(draft: Dataset, today: string): string[] {
  const rolled: string[] = [];
  for (const reminder of draft.reminders) {
    if (!reminder.enabled || reminder.repeat === "none") continue;
    const odometer = odometerOf(draft, reminder.vehicleId);
    const sides = dueSides(reminder, odometer, today);
    if (!sides.date && !sides.mileage) continue;

    const next = nextOccurrence(reminder, today, odometer);
    if (!next) continue;
    // Stamp the completed occurrence (history for the next roll-over).
    reminder.lastCompletedDate = today;
    reminder.lastCompletedMileage = odometer;
    reminder.dueDate = next.dueDate;
    reminder.dueMileage = next.dueMileage;
    reminder.updatedAt = new Date().toISOString();
    rolled.push(reminder.id);
  }
  return rolled;
}

/** Clears the persisted dedupe state (testing / reset support). */
export function clearReminderCheckState(): void {
  try {
    globalThis.localStorage?.removeItem(CHECK_STATE_KEY);
  } catch {
    // ignore
  }
}
