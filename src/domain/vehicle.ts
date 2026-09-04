import type { FuelType } from "./types";

/** User-entered vehicle data before it becomes a Vehicle (§9). */
export interface VehicleInput {
  name: string;
  make: string;
  model: string;
  /** Model year; null when unknown. */
  year: number | null;
  fuelType: FuelType | null;
  /** km/day; null when unknown. Only used for date estimation (§11). */
  averageDailyDistance: number | null;
}

export type VehicleError = "nameRequired" | "yearInvalid" | "averageInvalid";

/** Language-independent error codes — the UI maps them to localized messages. */
export function validateVehicle(input: VehicleInput): VehicleError[] {
  const errors: VehicleError[] = [];
  if (input.name.trim() === "") errors.push("nameRequired");
  if (input.year != null && (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2100)) {
    errors.push("yearInvalid");
  }
  if (
    input.averageDailyDistance != null &&
    (Number.isNaN(input.averageDailyDistance) || input.averageDailyDistance < 0)
  ) {
    errors.push("averageInvalid");
  }
  return errors;
}