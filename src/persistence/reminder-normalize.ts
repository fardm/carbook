import type { Dataset, Reminder } from "../domain/types";
import type { NotificationOffset, ReminderType, RepeatMode } from "../domain/types";

/**
 * Defensive per-row reminder repair — the repository's normalize() keeps
 * rows as-is (cast only), so this fills in missing optional fields with
 * safe defaults. Mirrors withOdometerStamp/withVehicleId there.
 *
 * v11 repairs (safe for previously stored data):
 * - repeat "weekly" is accepted; repeatWeekday is repaired to a 0–6
 *   integer (Saturday-first) or null.
 * - Legacy data with MULTIPLE advance intervals is collapsed to at most
 *   ONE days-offset and ONE km-offset (the first of each kind) — the
 *   current model does not support multiple intervals per kind, and this
 *   guarantees the checker/form never see duplicates.
 */

const REMINDER_TYPES: ReminderType[] = ["date", "mileage", "date_mileage"];
const REPEAT_MODES: RepeatMode[] = ["none", "weekly", "monthly", "yearly", "km"];

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
    repeatWeekday: normalizeWeekday(row.repeatWeekday, repeat),
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

/** Repairs the offsets array: keeps only well-formed {days?, km?} entries
 * and collapses to AT MOST ONE entry per kind (the first of each kind),
 * matching the single-advance-per-kind model. Legacy rows with multiple
 * same-kind intervals lose the extras instead of breaking anything. */
function normalizeOffsets(raw: unknown): NotificationOffset[] {
  if (!Array.isArray(raw)) return [];
  let daysOffset: NotificationOffset | null = null;
  let kmOffset: NotificationOffset | null = null;
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
    // First well-formed entry of each kind wins; extras of the same kind
    // are dropped (single advance-reminder per kind).
    if (offset.days != null && daysOffset === null) daysOffset = offset;
    else if (offset.km != null && kmOffset === null) kmOffset = offset;
  }
  const offsets: NotificationOffset[] = [];
  if (daysOffset !== null) offsets.push(daysOffset);
  if (kmOffset !== null) offsets.push(kmOffset);
  return offsets;
}

/** Repairs repeatWeekday: a 0–6 integer ONLY for repeat "weekly"; null otherwise. */
function normalizeWeekday(raw: unknown, repeat: RepeatMode): number | null {
  if (repeat !== "weekly") return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 6) return null;
  return raw;
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
