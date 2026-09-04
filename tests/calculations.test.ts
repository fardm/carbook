import { describe, expect, it } from "vitest";
import { defaultDataset } from "../src/domain/defaults";
import {
  calculateMaintenance,
  contextForVehicle,
  type CalculationContext,
} from "../src/domain/maintenance";
import type { MaintenanceItem, ServiceRecord } from "../src/domain/types";

const TODAY = "2026-04-01";

function makeItem(partial: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: "item-1",
    vehicleId: "v1",
    catalogId: null,
    name: "Item",
    category: "engine",
    icon: "wrench",
    rule: { intervalKm: 10000, intervalMonths: null, trigger: "any", displayMode: "auto", inspectionBased: false },
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function service(date: string, odometer: number | null, id = `s-${date}`): ServiceRecord {
  return {
    id,
    maintenanceItemId: "item-1",
    vehicleId: "v1",
    date,
    odometer,
    notes: "",
    cost: null,
    createdAt: `${date}T00:00:00.000Z`,
  };
}

/** The current odometer is a per-vehicle fact; a vehicle at `km`. */
function vehicleAt(km: number | null, avg: number | null = 40): { averageDailyDistance: number | null; currentOdometer: number | null } {
  return { averageDailyDistance: avg, currentOdometer: km };
}

function makeCtx(overrides: Partial<CalculationContext> = {}): CalculationContext {
  return {
    vehicle: vehicleAt(null),
    serviceHistory: [],
    inspectionHistory: [],
    settings: { statusThresholds: { dueSoonPercent: 20, duePercent: 5 } },
    ...overrides,
  };
}

describe("calculateMaintenance — distance (§22)", () => {
  it("computes remaining km: next due 110,000 − current 104,000 = 6,000", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const ctx = makeCtx({
      serviceHistory: [service("2026-01-10", 100000)],
      vehicle: vehicleAt(104000),
    });
    const result = calculateMaintenance(item, ctx, TODAY);
    expect(result.nextDueOdometer).toBe(110000);
    expect(result.remainingKm).toBe(6000);
    expect(result.remainingPercent).toBe(60);
    expect(result.primaryCriterion).toBe("km");
  });

  it("percentage: new = 100%, half = 50%, due = 0%, overdue = 0% (§28)", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const base = { serviceHistory: [service("2026-01-10", 100000)] };

    const fresh = calculateMaintenance(item, makeCtx({ ...base, vehicle: vehicleAt(100000) }), TODAY);
    expect(fresh.remainingPercent).toBe(100);
    expect(fresh.status).toBe("ok");

    const half = calculateMaintenance(item, makeCtx({ ...base, vehicle: vehicleAt(105000) }), TODAY);
    expect(half.remainingPercent).toBe(50);

    const due = calculateMaintenance(item, makeCtx({ ...base, vehicle: vehicleAt(110000) }), TODAY);
    expect(due.remainingPercent).toBe(0);
    expect(due.remainingKm).toBe(0);
    expect(due.status).toBe("due");

    const overdue = calculateMaintenance(item, makeCtx({ ...base, vehicle: vehicleAt(111000) }), TODAY);
    expect(overdue.remainingPercent).toBe(0);
    expect(overdue.remainingKm).toBe(-1000);
    expect(overdue.status).toBe("overdue");
  });

  it("overdue: current odometer past the next due odometer (§49)", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const ctx = makeCtx({
      serviceHistory: [service("2026-01-10", 100000)],
      vehicle: vehicleAt(112000),
    });
    const result = calculateMaintenance(item, ctx, TODAY);
    expect(result.remainingKm).toBe(-2000);
    expect(result.status).toBe("overdue");
  });
});

describe("calculateMaintenance — time (§23)", () => {
  it("computes remaining days: service 1 Jan, interval 6 months, today 1 Apr", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: null, intervalMonths: 6 } });
    const ctx = makeCtx({ serviceHistory: [service("2026-01-01", null)] });
    const result = calculateMaintenance(item, ctx, "2026-04-01");
    expect(result.nextDueDate).toBe("2026-07-01");
    expect(result.remainingDays).toBe(91);
    expect(result.primaryCriterion).toBe("time");
    expect(result.estimatedDueDate).toBe("2026-07-01");
    // 91 of 181 days remain → ~50.3%
    expect(result.remainingPercent).toBeCloseTo(50.28, 1);
  });

  it("exactly due today → status due", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: null, intervalMonths: 6 } });
    const ctx = makeCtx({ serviceHistory: [service("2026-01-01", null)] });
    const result = calculateMaintenance(item, ctx, "2026-07-01");
    expect(result.remainingDays).toBe(0);
    expect(result.status).toBe("due");
  });
});

describe("calculateMaintenance — distance + time (§25)", () => {
  it("time triggers first: 61 days vs estimated 150 days", () => {
    const item = makeItem({
      rule: { ...makeItem().rule, intervalKm: 10000, intervalMonths: 6 },
    });
    const ctx = makeCtx({
      serviceHistory: [service("2025-12-01", 100000)],
      vehicle: vehicleAt(104000), // 6,000 km left → 150 days @ 40/day
    });
    const result = calculateMaintenance(item, ctx, "2026-04-01");
    expect(result.remainingKm).toBe(6000);
    expect(result.estimatedKmDays).toBe(150);
    expect(result.remainingDays).toBe(61);
    expect(result.primaryCriterion).toBe("time");
    expect(result.estimatedDueDate).toBe("2026-06-01");
  });

  it("distance triggers first: 75 days vs 120 days", () => {
    const item = makeItem({
      rule: { ...makeItem().rule, intervalKm: 10000, intervalMonths: 8 },
    });
    const ctx = makeCtx({
      serviceHistory: [service("2025-09-01", 100000)],
      vehicle: vehicleAt(107000), // 3,000 km left → 75 days @ 40/day
    });
    const result = calculateMaintenance(item, ctx, "2026-01-01");
    expect(result.remainingKm).toBe(3000);
    expect(result.estimatedKmDays).toBe(75);
    expect(result.remainingDays).toBe(120);
    expect(result.primaryCriterion).toBe("km");
    expect(result.estimatedDueDate).toBe("2026-03-17"); // Jan 1 + 75 days
  });

  it("estimated due date honors calendar month lengths", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const ctx = makeCtx({
      serviceHistory: [service("2026-01-10", 100000)],
      vehicle: vehicleAt(104000),
    });
    const result = calculateMaintenance(item, ctx, "2026-04-01");
    expect(result.estimatedDueDate).toBe("2026-08-29"); // Apr 1 + 150 days
  });
});

describe("calculateMaintenance — odometer update propagation (§49)", () => {
  it("all km calculations update when the odometer changes", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const base = { serviceHistory: [service("2026-01-10", 100000)] };
    const at104000 = calculateMaintenance(item, makeCtx({ ...base, vehicle: vehicleAt(104000) }), TODAY);
    const at108000 = calculateMaintenance(item, makeCtx({ ...base, vehicle: vehicleAt(108000) }), TODAY);
    expect(at104000.remainingKm).toBe(6000);
    expect(at108000.remainingKm).toBe(2000);
    expect(at104000.status).toBe("upcoming"); // 60% left
    expect(at108000.status).toBe("dueSoon"); // exactly 20% left
  });
});

describe("calculateMaintenance — service reset (§49)", () => {
  it("a new service becomes the baseline; previous history is preserved", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const ctx = makeCtx({
      serviceHistory: [service("2026-01-10", 100000, "s1"), service("2026-04-01", 104000, "s2")],
      vehicle: vehicleAt(104500),
    });
    const result = calculateMaintenance(item, ctx, TODAY);
    expect(result.lastService).toEqual({ date: "2026-04-01", odometer: 104000 });
    expect(result.nextDueOdometer).toBe(114000);
    expect(result.remainingKm).toBe(9500);
    expect(ctx.serviceHistory).toHaveLength(2); // history untouched
  });
});

describe("calculateMaintenance — edge cases (§47)", () => {
  it("no current odometer → km values null, status ok, no estimate", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const result = calculateMaintenance(item, makeCtx({ serviceHistory: [service("2026-01-10", 100000)] }), TODAY);
    expect(result.remainingKm).toBeNull();
    expect(result.remainingPercent).toBeNull();
    expect(result.estimatedDueDate).toBeNull();
    expect(result.status).toBe("ok");
  });

  it("no average distance → estimated dates null, remaining km still shown (§11)", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const ctx = makeCtx({
      vehicle: vehicleAt(104000, null),
      serviceHistory: [service("2026-01-10", 100000)],
    });
    const result = calculateMaintenance(item, ctx, TODAY);
    expect(result.remainingKm).toBe(6000);
    expect(result.estimatedKmDays).toBeNull();
    expect(result.estimatedDueDate).toBeNull();
    expect(result.primaryCriterion).toBe("km");
  });

  it("zero average distance behaves like missing (§47)", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const ctx = makeCtx({
      vehicle: vehicleAt(104000, 0),
      serviceHistory: [service("2026-01-10", 100000)],
    });
    const result = calculateMaintenance(item, ctx, TODAY);
    expect(result.estimatedDueDate).toBeNull();
  });

  it("km+time with no average distance: time wins as the only estimable trigger", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000, intervalMonths: 6 } });
    const ctx = makeCtx({
      vehicle: vehicleAt(104000, null),
      serviceHistory: [service("2025-12-01", 100000)],
    });
    const result = calculateMaintenance(item, ctx, "2026-04-01");
    expect(result.primaryCriterion).toBe("time");
    expect(result.remainingKm).toBe(6000);
    expect(result.remainingDays).toBe(61);
  });

  it("no criteria at all → nothing computable, status ok", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: null, intervalMonths: null } });
    const result = calculateMaintenance(item, makeCtx(), TODAY);
    expect(result.remainingKm).toBeNull();
    expect(result.remainingPercent).toBeNull();
    expect(result.primaryCriterion).toBeNull();
    expect(result.status).toBe("ok");
  });

  it("a fresh dataset builds a context via contextForVehicle (§39)", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const dataset = defaultDataset();
    dataset.vehicles = [
      { id: "v1", name: "", make: "", model: "", year: null, fuelType: null, averageDailyDistance: 40, currentOdometer: 104000, createdAt: "", updatedAt: "" },
    ];
    dataset.serviceHistory = [service("2026-01-10", 100000)];
    const ctx = contextForVehicle(dataset, item.vehicleId);
    const result = calculateMaintenance(item, ctx, TODAY);
    expect(result.remainingKm).toBe(6000);
  });
});