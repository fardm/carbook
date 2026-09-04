import { addMonths, isoToDay } from "./dates";
import type { ServiceRecord } from "../types";

/**
 * nextDueOdometer = lastServiceOdometer + intervalKm (§22).
 * Null when the interval or the last service odometer is unknown.
 */
export function nextDueOdometer(
  lastService: ServiceRecord | null,
  intervalKm: number | null,
): number | null {
  if (intervalKm == null || lastService?.odometer == null) return null;
  return lastService.odometer + intervalKm;
}

/**
 * nextDueDate = lastServiceDate + intervalMonths (§23). Calendar-aware month
 * addition. Null when the interval or the last service date is unknown.
 */
export function nextDueDate(
  lastService: ServiceRecord | null,
  intervalMonths: number | null,
): string | null {
  if (intervalMonths == null || !lastService) return null;
  return addMonths(lastService.date, intervalMonths);
}

/** Number of calendar days in the configured time interval. Null when N/A. */
export function totalIntervalDays(
  lastServiceDate: string | null,
  nextDue: string | null,
): number | null {
  if (!lastServiceDate || !nextDue) return null;
  return isoToDay(nextDue) - isoToDay(lastServiceDate);
}