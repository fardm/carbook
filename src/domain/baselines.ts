import type { InspectionRecord, ServiceRecord } from "./types";

/** True when `a` is newer than `b` — compares (date, createdAt) ISO strings. */
function isNewer(a: { date: string; createdAt: string }, b: { date: string; createdAt: string }): boolean {
  if (a.date !== b.date) return a.date > b.date;
  return a.createdAt > b.createdAt;
}

/**
 * The latest service event for an item, or null (§18, §35).
 *
 * The "last service baseline" is NOT stored separately — service history is
 * the single source of truth, so a recorded service automatically becomes the
 * new baseline without duplicating data.
 */
export function lastServiceFor(
  serviceHistory: readonly ServiceRecord[],
  maintenanceItemId: string,
): ServiceRecord | null {
  let last: ServiceRecord | null = null;
  for (const record of serviceHistory) {
    if (record.maintenanceItemId !== maintenanceItemId) continue;
    if (!last || isNewer(record, last)) last = record;
  }
  return last;
}

/**
 * The latest inspection event for an item, or null (§18).
 * Inspections are tracked separately from services and never merged.
 */
export function lastInspectionFor(
  inspectionHistory: readonly InspectionRecord[],
  maintenanceItemId: string,
): InspectionRecord | null {
  let last: InspectionRecord | null = null;
  for (const record of inspectionHistory) {
    if (record.maintenanceItemId !== maintenanceItemId) continue;
    if (!last || isNewer(record, last)) last = record;
  }
  return last;
}