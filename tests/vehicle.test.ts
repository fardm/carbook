import { describe, expect, it } from "vitest";
import { LARGE_INCREASE_KM, validateOdometerEntry } from "../src/domain/odometer";
import { validateVehicle, type VehicleInput } from "../src/domain/vehicle";
import { faNum, formatDate, toLatinDigits } from "../src/ui/format";

function vehicleInput(partial: Partial<VehicleInput> = {}): VehicleInput {
  return {
    name: "پژو ۲۰۷",
    make: "پژو",
    model: "207",
    year: 2019,
    fuelType: "gasoline",
    averageDailyDistance: 40,
    ...partial,
  };
}

const validReading = { date: "2026-09-04", odometer: 104500 };
const latest = { id: "r1", date: "2026-08-20", odometer: 103900, createdAt: "2026-08-20T00:00:00.000Z" };

describe("validateVehicle", () => {
  it("accepts a complete valid input", () => {
    expect(validateVehicle(vehicleInput())).toEqual([]);
  });

  it("accepts a minimal input (name only)", () => {
    expect(validateVehicle(vehicleInput({ make: "", model: "", year: null, fuelType: null, averageDailyDistance: null }))).toEqual([]);
  });

  it("requires a non-empty name", () => {
    expect(validateVehicle(vehicleInput({ name: "  " }))).toEqual(["nameRequired"]);
  });

  it("rejects out-of-range or non-integer years", () => {
    expect(validateVehicle(vehicleInput({ year: 1800 }))).toEqual(["yearInvalid"]);
    expect(validateVehicle(vehicleInput({ year: 2101 }))).toEqual(["yearInvalid"]);
    expect(validateVehicle(vehicleInput({ year: 2019.5 }))).toEqual(["yearInvalid"]);
  });

  it("rejects negative or NaN average daily distance", () => {
    expect(validateVehicle(vehicleInput({ averageDailyDistance: -1 }))).toEqual(["averageInvalid"]);
    expect(validateVehicle(vehicleInput({ averageDailyDistance: Number.NaN }))).toEqual(["averageInvalid"]);
  });
});

describe("validateOdometerEntry (§47)", () => {
  it("accepts a valid reading", () => {
    expect(validateOdometerEntry(validReading, { today: "2026-09-04", latest })).toEqual({ errors: [], warnings: [] });
  });

  it("accepts the first reading (no latest)", () => {
    expect(validateOdometerEntry(validReading, { today: "2026-09-04", latest: null })).toEqual({ errors: [], warnings: [] });
  });

  it("requires a date", () => {
    expect(validateOdometerEntry({ ...validReading, date: "" }, { today: "2026-09-04", latest })).toEqual({
      errors: ["missingDate"],
      warnings: [],
    });
  });

  it("rejects malformed dates", () => {
    expect(validateOdometerEntry({ ...validReading, date: "2026-13-45" }, { today: "2026-09-04", latest }).errors).toContain("invalidDate");
    expect(validateOdometerEntry({ ...validReading, date: "04/09/2026" }, { today: "2026-09-04", latest }).errors).toContain("invalidDate");
  });

  it("rejects future dates", () => {
    expect(validateOdometerEntry({ ...validReading, date: "2026-09-05" }, { today: "2026-09-04", latest })).toEqual({
      errors: ["futureDate"],
      warnings: [],
    });
  });

  it("requires an odometer value", () => {
    expect(validateOdometerEntry({ ...validReading, odometer: null }, { today: "2026-09-04", latest }).errors).toContain("missingOdometer");
  });

  it("rejects negative or non-integer values", () => {
    expect(validateOdometerEntry({ ...validReading, odometer: -5 }, { today: "2026-09-04", latest }).errors).toContain("invalidOdometer");
    expect(validateOdometerEntry({ ...validReading, odometer: 104.5 }, { today: "2026-09-04", latest }).errors).toContain("invalidOdometer");
  });

  it("warns (but allows) a decrease", () => {
    const result = validateOdometerEntry({ ...validReading, odometer: 103000 }, { today: "2026-09-04", latest });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "decrease", delta: -900 }]);
  });

  it("warns (but allows) a large increase beyond the threshold", () => {
    const result = validateOdometerEntry(
      { ...validReading, odometer: latest.odometer + LARGE_INCREASE_KM + 1 },
      { today: "2026-09-04", latest },
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "largeIncrease", delta: LARGE_INCREASE_KM + 1 }]);
  });

  it("does not warn for an increase at or below the threshold", () => {
    const atThreshold = validateOdometerEntry(
      { ...validReading, odometer: latest.odometer + LARGE_INCREASE_KM },
      { today: "2026-09-04", latest },
    );
    expect(atThreshold.warnings).toEqual([]);
  });
});

describe("format helpers", () => {
  it("converts Persian and Arabic-Indic digits to Latin", () => {
    expect(toLatinDigits("۱۰۴۵۰۰")).toBe("104500");
    expect(toLatinDigits("٠٤٥")).toBe("045");
    expect(toLatinDigits("mix ۱۲۳ and 456")).toBe("mix 123 and 456");
  });

  it("formats numbers with Persian digits", () => {
    const formatted = faNum(104500);
    expect(formatted).toMatch(/[\u06F0-\u06F9]/); // contains Persian digits
    expect(formatted).not.toContain("104500");
  });

  it("formats ISO dates in the Jalali calendar", () => {
    const formatted = formatDate("2026-09-04");
    expect(formatted).toBeTypeOf("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});