/**
 * Calendar-aware presentation + boundary conversion.
 *
 * All persisted dates are Gregorian ISO strings. This module renders them
 * in the selected calendar (Solar Hijri by default) and converts dates at
 * the input boundary (a Jalali date chosen by the user → the Gregorian ISO
 * that is stored). `formatDate`/`formatDateTime` read the current
 * preference from the store unless an explicit calendar is passed (tests /
 * explicit call sites).
 */

import type { CalendarPreference } from "../types";
import { store } from "../../state/store";
import { GREGORIAN_MONTHS, gregorianToJalali, jalaliToGregorian, JALALI_MONTHS, parseJalaliIso } from "./jalali";
import { parseIso, toIso } from "./dates";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Converts Latin digits to Persian digits without grouping ("۱۴۰۵"). */
export function faDigits(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => FA_DIGITS[Number(digit)]);
}

/** The currently selected calendar system (Settings; default Jalali). */
export function currentCalendar(): CalendarPreference {
  return store.get().settings.calendar;
}

/**
 * Formats a Gregorian ISO date ("yyyy-mm-dd") in the given calendar, e.g.
 * "۱۳ شهریور ۱۴۰۵" (Jalali) or "۴ سپتامبر ۲۰۲۶" (Gregorian). Invalid input
 * returns "". Timezone-safe: works on the date parts directly.
 */
export function formatIso(iso: string, calendar: CalendarPreference): string {
  const parts = parseIso(iso);
  if (!parts) return "";
  if (calendar === "jalali") {
    const j = gregorianToJalali(parts.year, parts.month, parts.day);
    return `${faDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`;
  }
  return `${faDigits(parts.day)} ${GREGORIAN_MONTHS[parts.month - 1]} ${faDigits(parts.year)}`;
}

/** Formats an ISO date in the SELECTED calendar (defaults to the store
 * preference, Jalali unless the user chose Gregorian in settings). */
export function formatDate(iso: string, calendar?: CalendarPreference): string {
  return formatIso(iso, calendar ?? currentCalendar());
}

/**
 * Formats a full ISO datetime (e.g. an export timestamp) in the selected
 * calendar with the local time, e.g. "۱۳ شهریور ۱۴۰۵، ۱۵:۱۵".
 */
export function formatDateTime(iso: string, calendar?: CalendarPreference): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const cal = calendar ?? currentCalendar();
  const dateIso = toIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const time = `${faDigits(String(date.getHours()).padStart(2, "0"))}:${faDigits(String(date.getMinutes()).padStart(2, "0"))}`;
  return `${formatIso(dateIso, cal)}، ${time}`;
}

/* --- Input-boundary conversion (user-entered date → internal ISO) --- */

/** Validates a Jalali ISO ("jy-mm-dd") and converts it to the stored
 * Gregorian ISO; null when the Jalali date is invalid. */
export function jalaliIsoToGregorianIso(jalaliIso: string): string | null {
  const j = parseJalaliIso(jalaliIso);
  if (!j) return null;
  const g = jalaliToGregorian(j.jy, j.jm, j.jd);
  return toIso(g.gy, g.gm, g.gd);
}

/** Converts a stored Gregorian ISO to its Jalali ISO ("jy-mm-dd"). */
export function gregorianIsoToJalaliIso(iso: string): string | null {
  const parts = parseIso(iso);
  if (!parts) return null;
  const j = gregorianToJalali(parts.year, parts.month, parts.day);
  return toIso(j.jy, j.jm, j.jd);
}

/** ISO → the same date expressed in the given calendar as "y-mm-dd". */
export function toCalendarIso(iso: string, calendar: CalendarPreference): string | null {
  if (calendar === "jalali") return gregorianIsoToJalaliIso(iso);
  return parseIso(iso) ? iso : null;
}