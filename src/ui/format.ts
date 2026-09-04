/**
 * Display formatting for the Persian UI: Persian digits, thousand separators,
 * and Jalali calendar dates (via the native Intl fa-IR locale).
 */

const faNumberFormatter = new Intl.NumberFormat("fa-IR");

const faDateFormatter = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

/** Formats a number with Persian digits + locale separators, e.g. ۱۰۴٬۵۰۰. */
export function faNum(value: number): string {
  return faNumberFormatter.format(value);
}

/**
 * Normalizes Persian/Arabic-Indic digits to Latin so numeric inputs typed on
 * a Persian keyboard parse correctly (e.g. "۱۰۴٬۵۰۰" → "104,500").
 */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

/**
 * Formats an ISO date ("yyyy-mm-dd") in the Jalali calendar, e.g.
 * "۱۳ شهریور ۱۴۰۵". The date is anchored at local noon so timezone offsets
 * can never shift the displayed day.
 */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return faDateFormatter.format(new Date(year, month - 1, day, 12));
}

const faDateTimeFormatter = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Formats a full ISO datetime (e.g. an export timestamp) in the Jalali
 * calendar with the local time, e.g. "۱۳ شهریور ۱۴۰۵، ۱۴:۳۰".
 */
export function formatDateTime(iso: string): string {
  return faDateTimeFormatter.format(new Date(iso));
}