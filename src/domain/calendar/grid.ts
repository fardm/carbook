/**
 * Month-grid math for the calendar-aware date picker.
 *
 * Given a calendar system, a year and a month, produces the layout of a
 * month view: how many blank cells precede day 1 (Iranian convention —
 * weeks start on Saturday), the number of days in the month, and one cell
 * per day carrying the day-of-month AND the corresponding Gregorian ISO
 * (the app's internal representation). Pure and DOM-free so it is fully
 * unit-testable.
 */

import type { CalendarPreference } from "../types";
import {
  daysInJalaliMonth,
  jalaliToGregorian,
  JALALI_MONTHS,
  GREGORIAN_MONTHS,
} from "./jalali";
import { addDays, parseIso, toIso } from "./dates";

export interface MonthGridCell {
  /** Gregorian ISO "yyyy-mm-dd" of this day (the stored representation). */
  iso: string;
  /** Day of month in the displayed calendar (1–31). */
  day: number;
  /** True when this cell is today (for highlighting). */
  isToday: boolean;
}

export interface MonthGrid {
  calendar: CalendarPreference;
  /** Displayed year (Jalali or Gregorian depending on the calendar). */
  year: number;
  /** Displayed month, 1–12. */
  month: number;
  /** Localized month name for the heading. */
  monthName: string;
  /** Number of leading blank cells (week starts on Saturday). */
  lead: number;
  /** Number of days in this month. */
  days: number;
  cells: MonthGridCell[];
}

/** Gregorian ISO of the 1st of a month in the given calendar system. */
export function firstDayOfMonthIso(calendar: CalendarPreference, year: number, month: number): string {
  if (calendar === "jalali") {
    const g = jalaliToGregorian(year, month, 1);
    return toIso(g.gy, g.gm, g.gd);
  }
  return toIso(year, month, 1);
}

/** Day-of-week of an ISO date: 0 = Saturday … 6 = Friday (Saturday-first). */
export function weekdayOf(iso: string): number {
  const parts = parseIso(iso);
  if (!parts) throw new Error(`Invalid ISO date: "${iso}"`);
  // getUTCDay(): 0 = Sunday … 6 = Saturday → Saturday-first index.
  return (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 1) % 7;
}

/** Days in the displayed month for a calendar system. */
export function daysInMonth(calendar: CalendarPreference, year: number, month: number): number {
  if (calendar === "jalali") return daysInJalaliMonth(year, month);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Localized month name for a calendar system. */
export function monthName(calendar: CalendarPreference, month: number): string {
  return calendar === "jalali" ? JALALI_MONTHS[month - 1] : GREGORIAN_MONTHS[month - 1];
}

/** Builds the month grid (Saturday-first) for a calendar system. */
export function monthGrid(
  calendar: CalendarPreference,
  year: number,
  month: number,
  today: string,
): MonthGrid {
  const days = daysInMonth(calendar, year, month);
  const firstIso = firstDayOfMonthIso(calendar, year, month);
  const lead = weekdayOf(firstIso);

  const cells: MonthGridCell[] = [];
  for (let day = 1; day <= days; day += 1) {
    const iso = addDays(firstIso, day - 1);
    cells.push({ iso, day, isToday: iso === today });
  }

  return { calendar, year, month, monthName: monthName(calendar, month), lead, days, cells };
}