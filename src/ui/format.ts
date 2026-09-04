/**
 * Display formatting for the Persian UI: Persian digits and thousand
 * separators. Calendar-aware date formatting lives in
 * domain/calendar/format.ts (the centralized date service) and is
 * re-exported here so existing imports keep working.
 */

const faNumberFormatter = new Intl.NumberFormat("fa-IR");

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

export { faDigits, formatDate, formatDateTime } from "../domain/calendar/format";