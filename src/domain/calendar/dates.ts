/**
 * Centralized ISO date helpers — the app's internal date representation.
 *
 * All persisted dates are date-only Gregorian ISO strings ("yyyy-mm-dd").
 * This module is the single place for parsing, validating, comparing,
 * diffing, and adding/subtracting days and months on that representation.
 * All arithmetic works on whole UTC day numbers so results never depend on
 * the browser's timezone or DST. Month addition is calendar-aware
 * (PROJECT_PLAN §47: month/year boundaries, leap years).
 */

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface IsoParts {
  year: number;
  month: number;
  day: number;
}

/** "yyyy-mm-dd" → {year, month, day}; null when malformed or out-of-range. */
export function parseIso(iso: string): IsoParts | null {
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return { year, month, day };
}

/** Strict "yyyy-mm-dd" check that also rejects out-of-range calendar values. */
export function isValidIso(iso: string): boolean {
  return parseIso(iso) !== null;
}

/** "yyyy-mm-dd" → whole day number since the Unix epoch (UTC-based). */
export function isoToDayNumber(iso: string): number {
  const parts = parseIso(iso);
  if (!parts) throw new Error(`Invalid ISO date: "${iso}"`);
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

/** Whole day number → "yyyy-mm-dd" (UTC-based). */
export function dayNumberToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** y/m/d → "yyyy-mm-dd". */
export function toIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Today's date as "yyyy-mm-dd" in the user's local timezone. */
export function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Adds whole days to an ISO date. */
export function addDays(iso: string, days: number): string {
  return dayNumberToIso(isoToDayNumber(iso) + days);
}

/** Calendar-day difference: a − b. */
export function diffDays(a: string, b: string): number {
  return isoToDayNumber(a) - isoToDayNumber(b);
}

/** Lexicographic comparison of ISO dates (they compare chronologically). */
export function compareIso(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Adds calendar months to a date, clamping the day to the last day of the
 * target month (e.g. 2026-01-31 + 1 month = 2026-02-28; leap-year aware).
 */
export function addMonths(iso: string, months: number): string {
  const parts = parseIso(iso);
  if (!parts) throw new Error(`Invalid ISO date: "${iso}"`);
  const totalMonths = parts.year * 12 + (parts.month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(parts.day, daysInTargetMonth);
  return dayNumberToIso(
    Math.round(Date.UTC(targetYear, targetMonth - 1, clampedDay) / DAY_MS),
  );
}