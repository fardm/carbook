import type { FuelType } from "./types";

/** User-entered vehicle data before it becomes a Vehicle (§9). */
export interface VehicleInput {
  name: string;
  make: string;
  model: string;
  /** Production year; null when unknown. May be Solar Hijri (e.g. 1390) or
   * Gregorian (1900–2100). */
  year: number | null;
  fuelType: FuelType | null;
  /** Approximate km/year; null when unknown. Only used for date estimation (§11). */
  averageAnnualDistance: number | null;
}

export type VehicleError = "nameRequired" | "yearInvalid" | "averageInvalid";

/**
 * A production year is valid when it is a plausible Solar Hijri year
 * (1300–1500, roughly covering 1921–2121 Gregorian) OR a plausible
 * Gregorian year (1900–2100). Exclusively-Gregorian validation would
 * reject legitimate Jalali entries like 1390.
 */
export function isValidProductionYear(year: number): boolean {
  return (year >= 1300 && year <= 1500) || (year >= 1900 && year <= 2100);
}

/** Language-independent error codes — the UI maps them to localized messages. */
export function validateVehicle(input: VehicleInput): VehicleError[] {
  const errors: VehicleError[] = [];
  if (input.name.trim() === "") errors.push("nameRequired");
  if (input.year != null && (!Number.isInteger(input.year) || !isValidProductionYear(input.year))) {
    errors.push("yearInvalid");
  }
  if (
    input.averageAnnualDistance != null &&
    (!Number.isFinite(input.averageAnnualDistance) || input.averageAnnualDistance < 0)
  ) {
    errors.push("averageInvalid");
  }
  return errors;
}
