import { describe, expect, it } from "vitest";
import {
  calculateMaintenance,
  type CalculationContext,
  type MaintenanceStatus,
} from "../src/domain/maintenance";
import type {
  MaintenanceItem,
  ServiceRecord,
  StatusThresholds,
} from "../src/domain/types";

const TODAY = "2026-04-01";
const THRESHOLDS: StatusThresholds = { dueSoonPercent: 20, duePercent: 5 };

function makeItem(partial: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: "item-1",
    vehicleId: "v1",
    catalogId: null,
    name: "Item",
    category: "engine",
    icon: "wrench",
    rule: { intervalKm: 10000, intervalMonths: null, trigger: "any", displayMode: "auto" },
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function service(date: string, odometer: number | null): ServiceRecord {
  return { id: `s-${date}`, maintenanceItemId: "item-1", vehicleId: "v1", date, odometer, notes: "", cost: null, createdAt: `${date}T00:00:00.000Z` };
}

/** The current odometer is a per-vehicle fact; a vehicle at `km`. */
function vehicleAt(km: number | null): { averageAnnualDistance: number | null; currentOdometer: number | null } {
  return { averageAnnualDistance: 14600, currentOdometer: km };
}

function makeCtx(overrides: Partial<CalculationContext> = {}): CalculationContext {
  return {
    vehicle: vehicleAt(null),
    serviceHistory: [],
    settings: { statusThresholds: THRESHOLDS },
    ...overrides,
  };
}

function statusOf(
  item: MaintenanceItem,
  ctx: CalculationContext,
  today: string = TODAY,
): MaintenanceStatus {
  return calculateMaintenance(item, ctx, today).status;
}

describe("status — interval items", () => {
  it("maps percent tiers to statuses via configured thresholds (§29)", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const base = { serviceHistory: [service("2026-01-10", 100000)] };
    const at = (km: number) => statusOf(item, makeCtx({ ...base, vehicle: vehicleAt(km) }));

    expect(at(100000)).toBe("ok"); // 100%
    expect(at(105000)).toBe("upcoming"); // 50%
    expect(at(107000)).toBe("upcoming"); // 30%
    expect(at(108000)).toBe("dueSoon"); // exactly 20%
    expect(at(108500)).toBe("dueSoon"); // 15%
    expect(at(109500)).toBe("due"); // exactly 5%
    expect(at(110000)).toBe("due"); // 0%
    expect(at(111000)).toBe("overdue");
  });

  it("uses the configured thresholds from settings, not constants", () => {
    const item = makeItem({ rule: { ...makeItem().rule, intervalKm: 10000 } });
    const ctx = makeCtx({
      settings: { statusThresholds: { dueSoonPercent: 50, duePercent: 25 } },
      serviceHistory: [service("2026-01-10", 100000)],
      vehicle: vehicleAt(106000), // 40% remaining
    });
    // With stock thresholds 40% would be "upcoming"; custom thresholds make it "dueSoon".
    expect(statusOf(item, ctx)).toBe("dueSoon");
  });
});

describe("status — misc", () => {
  it("km+time item overdue on the time criterion reports overdue even when km has life left", () => {
    const item = makeItem({
      rule: { intervalKm: 10000, intervalMonths: 6, trigger: "any", displayMode: "auto" },
    });
    const ctx = makeCtx({
      serviceHistory: [service("2025-09-01", 100000)],
      vehicle: vehicleAt(104000), // km: plenty left
    });
    const result = calculateMaintenance(item, ctx, "2026-04-01");
    expect(result.remainingDays).toBe(-31); // time due 2026-03-01, already passed
    expect(result.primaryCriterion).toBe("time");
    expect(result.status).toBe("overdue");
  });
});