import { isValidIso } from "./calendar/dates";

/**
 * The odometer is a per-vehicle fact stored directly on Vehicle and updated
 * in place via بروزرسانی کیلومتر — there is no odometer history/log anymore.
 * This module keeps the strict ISO date check (re-exported centrally) and
 * the simple value validation shared by the mileage form.
 */

/** Strict "yyyy-mm-dd" check (centralized in domain/calendar/dates). */
export function isIsoDate(value: string): boolean {
  return isValidIso(value);
}

export type OdometerValueError = "missingOdometer" | "invalidOdometer";

/** Validates a mileage value: required, non-negative integer. */
export function validateMileage(value: number | null): OdometerValueError[] {
  const errors: OdometerValueError[] = [];
  if (value == null) {
    errors.push("missingOdometer");
  } else if (!Number.isInteger(value) || value < 0) {
    errors.push("invalidOdometer");
  }
  return errors;
}