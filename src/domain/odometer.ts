import type { OdometerReading } from "./types";

/** A jump larger than this (km) triggers a "large increase" warning (§47). */
export const LARGE_INCREASE_KM = 5000;

/**
 * Sorts readings oldest → newest by (date, createdAt). ISO strings compare
 * lexicographically, so no date parsing is needed. Returns a new array.
 */
export function sortReadings(readings: readonly OdometerReading[]): OdometerReading[] {
  return [...readings].sort((a, b) => compareByDate(a, b));
}

/** The latest valid reading — the current odometer (§10). Null when empty. */
export function getCurrentOdometer(
  dataset: { odometerHistory: readonly OdometerReading[] },
): OdometerReading | null {
  const sorted = sortReadings(dataset.odometerHistory);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/** Compares two records by (date, createdAt) — newest sorts last. */
export function compareByDate(
  a: { date: string; createdAt: string },
  b: { date: string; createdAt: string },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

/**
 * Validation for a recorded odometer reading (§47). Language-independent
 * error codes — the UI maps them to localized messages.
 */
export type OdometerError =
  | "missingDate"
  | "invalidDate"
  | "futureDate"
  | "missingOdometer"
  | "invalidOdometer";

export type OdometerWarningKind = "decrease" | "largeIncrease";

export interface OdometerEntry {
  /** "yyyy-mm-dd". */
  date: string;
  odometer: number | null;
}

export interface OdometerValidation {
  errors: OdometerError[];
  /** Non-blocking notices: a decrease or a large jump vs. the latest reading. */
  warnings: { kind: OdometerWarningKind; delta: number }[];
}

/**
 * Validates a reading. A future date is rejected (it would skew the derived
 * current odometer and all estimates). Decreases and large jumps are warned
 * about but allowed — they are legitimate (cluster replacement, correction)
 * and the reading history remains inspectable/editable.
 */
export function validateOdometerEntry(
  entry: OdometerEntry,
  ctx: { today: string; latest: OdometerReading | null },
): OdometerValidation {
  const errors: OdometerError[] = [];
  if (entry.date === "") {
    errors.push("missingDate");
  } else if (!isIsoDate(entry.date)) {
    errors.push("invalidDate");
  } else if (entry.date > ctx.today) {
    errors.push("futureDate");
  }

  if (entry.odometer == null) {
    errors.push("missingOdometer");
  } else if (!Number.isInteger(entry.odometer) || entry.odometer < 0) {
    errors.push("invalidOdometer");
  }

  const warnings: { kind: OdometerWarningKind; delta: number }[] = [];
  if (errors.length === 0 && entry.odometer != null && ctx.latest != null) {
    const delta = entry.odometer - ctx.latest.odometer;
    if (delta < 0) warnings.push({ kind: "decrease", delta });
    else if (delta > LARGE_INCREASE_KM) warnings.push({ kind: "largeIncrease", delta });
  }
  return { errors, warnings };
}

/** Strict "yyyy-mm-dd" check that also rejects out-of-range calendar values. */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}