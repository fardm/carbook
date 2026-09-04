import { describe, expect, it } from "vitest";
import {
  calculateMaintenance,
  type CalculationContext,
  type MaintenanceStatus,
} from "../src/domain/maintenance";
import type {
  InspectionRecord,
  MaintenanceItem,
  OdometerReading,
  ServiceRecord,
  StatusThresholds,
} from "../src/domain/types";

const TODAY = "2026-04-01";
const THRESHOLDS: StatusThresholds = { dueSoonPercent: 20, duePercent: 5 };

function makeItem(partial: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: "item-1",
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

function service(date: string, odometer: number | null): ServiceRecord {
  return { id: `s-${date}`, maintenanceItemId: "item-1", date, odometer, notes: "", cost: null, createdAt: `${date}T00:00:00.000Z` };
}

function reading(date: string, odometer: number): OdometerReading {
  return { id: `r-${date}`, date, odometer, createdAt: `${date}T00:00:00.000Z` };
}

function inspection(partial: Partial<InspectionRecord>): InspectionRecord {
  return {
    id: "i1",
    maintenanceItemId: "item-1",
    date: "2026-01-01",
    odometer: null,
    condition: "good",
    measurement: null,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function makeCtx(overrides: Partial<CalculationContext> = {}): CalculationContext {
  return {
    vehicle: { averageDailyDistance: 40 },
    odometerHistory: [],
    serviceHistory: [],
    inspectionHistory: [],
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
    const at = (km: number) => statusOf(item, makeCtx({ ...base, odometerHistory: [reading("2026-04-01", km)] }));

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
      odometerHistory: [reading("2026-04-01", 106000)], // 40% remaining
    });
    // With stock thresholds 40% would be "upcoming"; custom thresholds make it "dueSoon".
    expect(statusOf(item, ctx)).toBe("dueSoon");
  });
});

describe("status — inspection items (§16, §28, §36)", () => {
  const inspectionItem = makeItem({
    rule: { intervalKm: null, intervalMonths: null, trigger: "any", displayMode: "auto", inspectionBased: true },
  });

  it("never inspected → INSPECTION_REQUIRED", () => {
    expect(statusOf(inspectionItem, makeCtx())).toBe("inspectionRequired");
  });

  it("maps condition to status without fabricating remaining life", () => {
    const withCondition = (condition: InspectionRecord["condition"]) =>
      statusOf(inspectionItem, makeCtx({ inspectionHistory: [inspection({ condition })] }));

    expect(withCondition("good")).toBe("ok");
    expect(withCondition("watch")).toBe("upcoming");
    expect(withCondition("replaceSoon")).toBe("dueSoon");
    expect(withCondition("replaceNow")).toBe("due");
    expect(withCondition(null)).toBe("ok");
  });

  it("reports INSPECTION_REQUIRED when the month interval has been exceeded", () => {
    const item = makeItem({
      rule: { intervalKm: null, intervalMonths: 6, trigger: "any", displayMode: "auto", inspectionBased: true },
    });
    const ctx = makeCtx({ inspectionHistory: [inspection({ date: "2025-06-01", condition: "good" })] });
    expect(statusOf(item, ctx, "2026-04-01")).toBe("inspectionRequired"); // due 2025-12-01
  });

  it("does not report INSPECTION_REQUIRED while within the month interval", () => {
    const item = makeItem({
      rule: { intervalKm: null, intervalMonths: 6, trigger: "any", displayMode: "auto", inspectionBased: true },
    });
    const ctx = makeCtx({ inspectionHistory: [inspection({ date: "2025-11-01", condition: "watch" })] });
    expect(statusOf(item, ctx, "2026-04-01")).toBe("upcoming"); // due 2026-05-01, condition watch
  });

  it("reports INSPECTION_REQUIRED when the km interval has been exceeded", () => {
    const item = makeItem({
      rule: { intervalKm: 10000, intervalMonths: null, trigger: "any", displayMode: "auto", inspectionBased: true },
    });
    const overdue = makeCtx({
      inspectionHistory: [inspection({ odometer: 100000, condition: "good" })],
      odometerHistory: [reading("2026-04-01", 111000)],
    });
    expect(statusOf(item, overdue)).toBe("inspectionRequired"); // 111,000 ≥ 110,000

    const within = makeCtx({
      inspectionHistory: [inspection({ odometer: 100000, condition: "good" })],
      odometerHistory: [reading("2026-04-01", 109000)],
    });
    expect(statusOf(item, within)).toBe("ok");
  });
});

describe("status — misc", () => {
  it("an inspection-based item never gets a fabricated percentage", () => {
    const item = makeItem({
      rule: { intervalKm: null, intervalMonths: null, trigger: "any", displayMode: "auto", inspectionBased: true },
    });
    const result = calculateMaintenance(
      item,
      makeCtx({ inspectionHistory: [inspection({ condition: "good" })] }),
      TODAY,
    );
    expect(result.remainingPercent).toBeNull();
    expect(result.status).toBe("ok");
  });

  it("km+time item overdue on the time criterion reports overdue even when km has life left", () => {
    const item = makeItem({
      rule: { intervalKm: 10000, intervalMonths: 6, trigger: "any", displayMode: "auto", inspectionBased: false },
    });
    const ctx = makeCtx({
      serviceHistory: [service("2025-09-01", 100000)],
      odometerHistory: [reading("2026-04-01", 104000)], // km: plenty left
    });
    const result = calculateMaintenance(item, ctx, "2026-04-01");
    expect(result.remainingDays).toBe(-31); // time due 2026-03-01, already passed
    expect(result.primaryCriterion).toBe("time");
    expect(result.status).toBe("overdue");
  });
});