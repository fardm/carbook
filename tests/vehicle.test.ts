import { describe, expect, it } from "vitest";
import { validateMileage } from "../src/domain/odometer";
import { validateVehicle, type VehicleInput } from "../src/domain/vehicle";
import { faNum, formatDate, toLatinDigits } from "../src/ui/format";

function vehicleInput(partial: Partial<VehicleInput> = {}): VehicleInput {
  return {
    name: "پژو ۲۰۷",
    make: "پژو",
    model: "207",
    year: 1390,
    fuelType: "gasoline",
    averageAnnualDistance: 14600,
    ...partial,
  };
}

describe("validateVehicle", () => {
  it("accepts a complete valid input", () => {
    expect(validateVehicle(vehicleInput())).toEqual([]);
  });

  it("accepts a minimal input (name only)", () => {
    expect(validateVehicle(vehicleInput({ make: "", model: "", year: null, fuelType: null, averageAnnualDistance: null }))).toEqual([]);
  });

  it("requires a non-empty name", () => {
    expect(validateVehicle(vehicleInput({ name: "  " }))).toEqual(["nameRequired"]);
  });

  it("accepts a Solar Hijri production year (1390)", () => {
    expect(validateVehicle(vehicleInput({ year: 1390 }))).toEqual([]);
    expect(validateVehicle(vehicleInput({ year: 1403 }))).toEqual([]);
  });

  it("accepts a Gregorian production year (2019)", () => {
    expect(validateVehicle(vehicleInput({ year: 2019 }))).toEqual([]);
  });

  it("rejects out-of-range or non-integer years in either calendar system", () => {
    expect(validateVehicle(vehicleInput({ year: 1800 }))).toEqual(["yearInvalid"]);
    expect(validateVehicle(vehicleInput({ year: 2101 }))).toEqual(["yearInvalid"]);
    expect(validateVehicle(vehicleInput({ year: 999 }))).toEqual(["yearInvalid"]);
    expect(validateVehicle(vehicleInput({ year: 2019.5 }))).toEqual(["yearInvalid"]);
  });

  it("rejects negative or NaN average annual distance", () => {
    expect(validateVehicle(vehicleInput({ averageAnnualDistance: -1 }))).toEqual(["averageInvalid"]);
    expect(validateVehicle(vehicleInput({ averageAnnualDistance: Number.NaN }))).toEqual(["averageInvalid"]);
  });
});

describe("validateMileage", () => {
  it("accepts a non-negative integer", () => {
    expect(validateMileage(104500)).toEqual([]);
    expect(validateMileage(0)).toEqual([]);
  });

  it("rejects a missing value", () => {
    expect(validateMileage(null)).toEqual(["missingOdometer"]);
  });

  it("rejects negative or non-integer values", () => {
    expect(validateMileage(-5)).toEqual(["invalidOdometer"]);
    expect(validateMileage(104.5)).toEqual(["invalidOdometer"]);
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