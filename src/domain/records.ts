import { isIsoDate } from "./odometer";

/**
 * Validation for recording/editing service EVENTS (§35).
 *
 * Language-independent error codes — the UI maps them to localized messages
 * (same pattern as odometer/vehicle validation). History records themselves
 * are never deleted (§34); corrections edit the record in place (decision 22).
 */

/* --- Service events (§35) --- */

export type ServiceRecordError =
  | "missingDate"
  | "invalidDate"
  | "futureDate"
  | "invalidOdometer"
  | "invalidCost";

export interface ServiceRecordEntry {
  /** "yyyy-mm-dd". */
  date: string;
  /** km at service time; null when unknown (empty input). */
  odometer: number | null;
  /** Optional cost. */
  cost: number | null;
}

/**
 * Validates a service event. Date is required, must be a real date, and must
 * not be in the future (§47). Odometer and cost are optional but must be
 * non-negative (odometer an integer) when provided.
 */
export function validateServiceRecordEntry(
  entry: ServiceRecordEntry,
  ctx: { today: string },
): ServiceRecordError[] {
  const errors: ServiceRecordError[] = [];
  if (entry.date === "") errors.push("missingDate");
  else if (!isIsoDate(entry.date)) errors.push("invalidDate");
  else if (entry.date > ctx.today) errors.push("futureDate");

  if (entry.odometer != null && (!Number.isInteger(entry.odometer) || entry.odometer < 0)) {
    errors.push("invalidOdometer");
  }
  if (entry.cost != null && (!Number.isFinite(entry.cost) || entry.cost < 0)) {
    errors.push("invalidCost");
  }
  return errors;
}

/* --- History ordering --- */

/**
 * Sorts history records newest → oldest by (date, createdAt). ISO strings
 * compare lexicographically; `createdAt` breaks same-date ties (newest
 * created first). Returns a new array.
 */
export function sortHistoryNewestFirst<T extends { date: string; createdAt: string }>(
  records: readonly T[],
): T[] {
  return [...records].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return 0;
  });
}
