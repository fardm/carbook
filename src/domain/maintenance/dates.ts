/**
 * Calendar helpers for date-only ISO strings ("yyyy-mm-dd").
 *
 * All arithmetic works on whole UTC day numbers so results never depend on
 * the browser's timezone or DST. Month addition is calendar-aware
 * (PROJECT_PLAN §47: month/year boundaries, leap years).
 */

const DAY_MS = 86_400_000;

/** "yyyy-mm-dd" → whole day number since the Unix epoch (UTC-based). */
export function isoToDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Whole day number → "yyyy-mm-dd" (UTC-based). */
export function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Today's date as "yyyy-mm-dd" in the user's local timezone. */
export function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Adds calendar months to a date, clamping the day to the last day of the
 * target month (e.g. 2026-01-31 + 1 month = 2026-02-28).
 */
export function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return dayToIso(Math.round(Date.UTC(targetYear, targetMonth - 1, clampedDay) / DAY_MS));
}