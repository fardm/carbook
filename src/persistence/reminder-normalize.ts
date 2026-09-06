import type { Dataset, Reminder } from "../domain/types";
import type { NotificationOffset, ReminderType, RepeatMode } from "../domain/types";

/**
 * Defensive per-row reminder repair — the repository's normalize() keeps
 * rows as-is (cast only), so this fills in missing optional fields with
 * safe defaults. Mirrors withOdometerStamp/withVehicleId there.
 */

const REMINDER_TYPES: ReminderType[] = ["date", "mileage", "date_mileage"];
const REPEAT_MODES: RepeatMode[] = ["none", "monthly", "yearly", "km"];

/** Repairs one reminder row into a complete Reminder (best effort). */
export function normalizeReminder(raw: unknown): Reminder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const now = new Date().toISOString();

  const type = REMINDER_TYPES.includes(row.type as ReminderType) ? (row.type as ReminderType) : "date";
  const repeat = REPEAT_MODES.includes(row.repeat as RepeatMode) ? (row.repeat as RepeatMode) : "none";

  return {
    id: typeof row.id === "string" && row.id !== "" ? row.id : `reminder-${Math.random().toString(36).slice(2, 10)}`,
    vehicleId: typeof row.vehicleId === "string" ? row.vehicleId : "",
    title: typeof row.title === "string" ? row.title : "",
    description: typeof row.description === "string" ? row.description : "",
    serviceId: typeof row.serviceId === "string" && row.serviceId !== "" ? row.serviceId : null,
    type,
    dueDate: typeof row.dueDate === "string" ? row.dueDate : null,
    dueMileage:
      typeof row.dueMileage === "number" && Number.isFinite(row.dueMileage) ? row.dueMileage : null,
    notificationOffsets: normalizeOffsets(row.notificationOffsets),
    repeat,
    repeatEveryKm: typeof row.repeatEveryKm === "number" && Number.isFinite(row.repeatEveryKm) ? row.repeatEveryKm : null,
    enabled: row.enabled !== false,
    lastCompletedDate: typeof row.lastCompletedDate === "string" ? row.lastCompletedDate : null,
    lastCompletedMileage:
      typeof row.lastCompletedMileage === "number" && Number.isFinite(row.lastCompletedMileage)
        ? row.lastCompletedMileage
        : null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
  };
}

/** Repairs the offsets array: keeps only well-formed {days?, km?} entries. */
function normalizeOffsets(raw: unknown): NotificationOffset[] {
  if (!Array.isArray(raw)) return [];
  const offsets: NotificationOffset[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const offset: NotificationOffset = {};
    if (typeof row.days === "number" && Number.isFinite(row.days) && row.days >= 0) {
      offset.days = Math.round(row.days);
    }
    if (typeof row.km === "number" && Number.isFinite(row.km) && row.km >= 0) {
      offset.km = Math.round(row.km);
    }
    if (offset.days != null || offset.km != null) offsets.push(offset);
  }
  return offsets;
}

/** Repairs every reminder in a dataset (used after import / migration). */
export function normalizeReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeReminder).filter((reminder): reminder is Reminder => reminder !== null);
}

/** Convenience guard for the repository. */
export function datasetHasReminders(dataset: Dataset): boolean {
  return Array.isArray(dataset.reminders);
}
