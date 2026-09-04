import { describe, expect, it } from "vitest";
import { defaultDataset } from "../src/domain/defaults";
import { createId } from "../src/domain/ids";
import { lastInspectionFor, lastServiceFor } from "../src/domain/baselines";
import { getCurrentOdometer, sortReadings } from "../src/domain/odometer";
import type { Dataset, InspectionRecord, OdometerReading, ServiceRecord } from "../src/domain/types";

function reading(partial: Partial<OdometerReading>): OdometerReading {
  return { id: createId(), date: "2026-01-01", odometer: 1000, createdAt: "2026-01-01T00:00:00.000Z", ...partial };
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

describe("getCurrentOdometer", () => {
  it("returns null when there are no readings", () => {
    expect(getCurrentOdometer(defaultDataset())).toBeNull();
  });

  it("returns the latest reading by date", () => {
    const dataset = defaultDataset();
    dataset.odometerHistory = [
      reading({ date: "2026-08-20", odometer: 103900 }),
      reading({ date: "2026-09-03", odometer: 104500 }),
      reading({ date: "2026-08-05", odometer: 103200 }),
    ];
    expect(getCurrentOdometer(dataset)?.odometer).toBe(104500);
  });

  it("breaks date ties by createdAt", () => {
    const dataset = defaultDataset();
    dataset.odometerHistory = [
      reading({ date: "2026-09-03", odometer: 104000, createdAt: "2026-09-03T08:00:00.000Z" }),
      reading({ date: "2026-09-03", odometer: 105000, createdAt: "2026-09-03T10:00:00.000Z" }),
    ];
    expect(getCurrentOdometer(dataset)?.odometer).toBe(105000);
  });

  it("sortReadings does not mutate the input", () => {
    const readings = [reading({ date: "2026-09-03" }), reading({ date: "2026-08-05" })];
    const before = [...readings];
    sortReadings(readings);
    expect(readings).toEqual(before);
  });
});

describe("lastServiceFor / lastInspectionFor", () => {
  const itemId = "item-1";

  it("returns null when the item has no records", () => {
    const dataset: Dataset = defaultDataset();
    expect(lastServiceFor(dataset.serviceHistory, itemId)).toBeNull();
    expect(lastInspectionFor(dataset.inspectionHistory, itemId)).toBeNull();
  });

  it("picks the latest service by (date, createdAt) and ignores other items", () => {
    const dataset = defaultDataset();
    dataset.serviceHistory = [
      { id: "s1", maintenanceItemId: "other", date: "2026-09-03", odometer: 1, notes: "", cost: null, createdAt: "2026-09-03T00:00:00.000Z" },
      { id: "s2", maintenanceItemId: itemId, date: "2026-03-10", odometer: 96800, notes: "", cost: null, createdAt: "2026-03-10T00:00:00.000Z" },
      { id: "s3", maintenanceItemId: itemId, date: "2026-09-03", odometer: 104500, notes: "", cost: null, createdAt: "2026-09-03T09:00:00.000Z" },
      { id: "s4", maintenanceItemId: itemId, date: "2026-09-03", odometer: 104000, notes: "", cost: null, createdAt: "2026-09-03T08:00:00.000Z" },
    ];
    expect(lastServiceFor(dataset.serviceHistory, itemId)?.id).toBe("s3");
  });

  it("keeps services and inspections fully separate (§18)", () => {
    const dataset = defaultDataset();
    dataset.serviceHistory = [
      { id: "s1", maintenanceItemId: itemId, date: "2026-01-10", odometer: 80000, notes: "", cost: null, createdAt: "2026-01-10T00:00:00.000Z" },
    ];
    dataset.inspectionHistory = [
      { id: "i1", maintenanceItemId: itemId, date: "2026-08-20", odometer: 103900, condition: "good", measurement: null, notes: "", createdAt: "2026-08-20T00:00:00.000Z" },
    ];
    const inspection: InspectionRecord = dataset.inspectionHistory[0];
    const service: ServiceRecord = dataset.serviceHistory[0];
    expect(lastInspectionFor(dataset.inspectionHistory, itemId)?.id).toBe(inspection.id);
    expect(lastServiceFor(dataset.serviceHistory, itemId)?.id).toBe(service.id);
  });
});