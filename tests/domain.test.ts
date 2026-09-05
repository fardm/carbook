import { describe, expect, it } from "vitest";
import { defaultDataset } from "../src/domain/defaults";
import { createId } from "../src/domain/ids";
import { lastServiceFor } from "../src/domain/baselines";
import { validateMileage, isIsoDate } from "../src/domain/odometer";
import { validateVehicle, type VehicleInput } from "../src/domain/vehicle";
import type { Dataset, ServiceRecord } from "../src/domain/types";

function vehicleInput(partial: Partial<VehicleInput> = {}): VehicleInput {
  return {
    name: "پژو ۲۰۷",
    make: "پژو",
    model: "207",
    year: null,
    fuelType: "gasoline",
    averageDailyDistance: null,
    ...partial,
  };
}

function service(partial: Partial<ServiceRecord>): ServiceRecord {
  return {
    id: createId(),
    maintenanceItemId: "item-1",
    vehicleId: "v1",
    date: "2026-01-01",
    odometer: 1000,
    notes: "",
    cost: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("createId", () => {
  it("returns unique non-empty strings", () => {
    const a = createId();
    const b = createId();
    expect(a).toBeTypeOf("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe("validateMileage", () => {
  it("accepts a non-negative integer", () => {
    expect(validateMileage(1024)).toEqual([]);
    expect(validateMileage(0)).toEqual([]);
  });

  it("rejects missing / negative / fractional values", () => {
    expect(validateMileage(null)).toContain("missingOdometer");
    expect(validateMileage(-1)).toContain("invalidOdometer");
    expect(validateMileage(12.5)).toContain("invalidOdometer");
  });
});

describe("isIsoDate", () => {
  it("accepts valid yyyy-mm-dd and rejects malformed dates", () => {
    expect(isIsoDate("2026-03-21")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-03-21")).toBe(false);
  });
});

describe("validateVehicle", () => {
  it("requires a name", () => {
    expect(validateVehicle(vehicleInput({ name: "   " }))).toContain("nameRequired");
  });

  it("accepts a Solar Hijri production year (1390) — no Gregorian-only bounds", () => {
    expect(validateVehicle(vehicleInput({ year: 1390 }))).not.toContain("yearInvalid");
  });

  it("rejects clearly invalid years in either calendar system", () => {
    expect(validateVehicle(vehicleInput({ year: -5 }))).toContain("yearInvalid");
    expect(validateVehicle(vehicleInput({ year: 99.5 }))).toContain("yearInvalid");
  });
});

describe("lastServiceFor", () => {
  const itemId = "item-1";

  it("returns null when the item has no records", () => {
    const dataset: Dataset = defaultDataset();
    expect(lastServiceFor(dataset.serviceHistory, itemId)).toBeNull();
  });

  it("picks the latest service by (date, createdAt) and ignores other items", () => {
    const dataset = defaultDataset();
    dataset.serviceHistory = [
      service({ id: "s1", maintenanceItemId: "other", date: "2026-09-03", odometer: 1 }),
      service({ id: "s2", maintenanceItemId: itemId, date: "2026-03-10", odometer: 96800 }),
      service({ id: "s3", maintenanceItemId: itemId, date: "2026-09-03", odometer: 104500, createdAt: "2026-09-03T09:00:00.000Z" }),
      service({ id: "s4", maintenanceItemId: itemId, date: "2026-09-03", odometer: 104000, createdAt: "2026-09-03T08:00:00.000Z" }),
    ];
    expect(lastServiceFor(dataset.serviceHistory, itemId)?.id).toBe("s3");
  });

  it("picks the latest by (date, createdAt)", () => {
    const dataset = defaultDataset();
    dataset.serviceHistory = [service({ id: "s1", date: "2026-01-10", odometer: 80000 })];
    expect(lastServiceFor(dataset.serviceHistory, itemId)?.id).toBe("s1");
  });
});