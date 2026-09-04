import { describe, expect, it } from "vitest";
import type { MaintenanceCalculation, MaintenanceStatus } from "../src/domain/maintenance";
import type { DisplayMode } from "../src/domain/types";
import {
  compareByUrgency,
  formatRemainingTime,
  healthBand,
  primaryMetricText,
  resolvePrimaryMetric,
  secondaryMetricText,
  statusLabel,
  summaryBucket,
  urgencyRank,
} from "../src/ui/maintenance-display";

function calc(partial: Partial<MaintenanceCalculation>): MaintenanceCalculation {
  return {
    status: "ok",
    remainingKm: null,
    remainingDays: null,
    estimatedKmDays: null,
    estimatedDueDate: null,
    remainingPercent: null,
    primaryCriterion: null,
    nextDueOdometer: null,
    nextDueDate: null,
    totalIntervalDays: null,
    lastService: null,
    ...partial,
  };
}

describe("resolvePrimaryMetric (§26)", () => {
  const kmCalc = calc({ remainingKm: 6000, remainingDays: 61, primaryCriterion: "km", estimatedKmDays: 150 });

  it("auto follows the engine's primary criterion", () => {
    expect(resolvePrimaryMetric(kmCalc, "auto")).toBe("km");
    expect(resolvePrimaryMetric(calc({ remainingKm: 6000, remainingDays: 61, primaryCriterion: "time" }), "auto")).toBe("days");
  });

  it("explicit modes prefer their own criterion and fall back otherwise", () => {
    expect(resolvePrimaryMetric(kmCalc, "km")).toBe("km");
    expect(resolvePrimaryMetric(kmCalc, "time")).toBe("days");
    expect(resolvePrimaryMetric(calc({ remainingKm: 6000, remainingDays: null }), "time")).toBe("km");
  });

  it("both shows the primary criterion", () => {
    expect(resolvePrimaryMetric(kmCalc, "both")).toBe("km");
  });

  it("inspection/no-metric items resolve to none", () => {
    expect(resolvePrimaryMetric(calc({ remainingKm: null, remainingDays: null }), "auto")).toBe("none");
  });
});

describe("primaryMetricText (§27)", () => {
  it("formats km remaining and past", () => {
    expect(primaryMetricText(calc({ remainingKm: 6000 }), "km")).toContain("۶٬۰۰۰");
    expect(primaryMetricText(calc({ remainingKm: 6000 }), "km")).toContain("باقی‌مانده");
    expect(primaryMetricText(calc({ remainingKm: -2000 }), "km")).toContain("۲٬۰۰۰");
    expect(primaryMetricText(calc({ remainingKm: -2000 }), "km")).toContain("گذشته");
  });

  it("formats day remaining and past", () => {
    expect(primaryMetricText(calc({ remainingDays: 120 }), "days")).toContain("روز");
    expect(primaryMetricText(calc({ remainingDays: -5 }), "days")).toContain("گذشته");
  });

  it("returns null when the metric is unavailable", () => {
    expect(primaryMetricText(calc({}), "none")).toBeNull();
    expect(primaryMetricText(calc({ remainingKm: null, remainingDays: 5 }), "km")).toBeNull();
  });
});

describe("secondaryMetricText", () => {
  it("km-primary shows the estimated time", () => {
    expect(secondaryMetricText(calc({ estimatedKmDays: 45 }), "km")).toBe("~۴۵ روز");
    expect(secondaryMetricText(calc({ estimatedKmDays: 150 }), "km")).toBe("~۵ ماه");
  });

  it("time-primary shows the remaining percentage", () => {
    expect(secondaryMetricText(calc({ remainingPercent: 66.66 }), "days")).toContain("۶۷٪");
  });
});

describe("formatRemainingTime (§23)", () => {
  it("keeps days for short horizons", () => {
    expect(formatRemainingTime(12)).toBe("۱۲ روز");
    expect(formatRemainingTime(0)).toBe("۰ روز");
  });

  it("switches to months for large horizons", () => {
    expect(formatRemainingTime(120)).toBe("۴ ماه");
    expect(formatRemainingTime(150)).toBe("۵ ماه");
    expect(formatRemainingTime(90)).toBe("۳ ماه");
  });
});

describe("status labels and urgency (§29, §30)", () => {
  it("maps every status to a label and a rank", () => {
    const statuses: MaintenanceStatus[] = ["ok", "upcoming", "dueSoon", "due", "overdue", "inspectionRequired"];
    for (const status of statuses) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
      expect(urgencyRank(status)).toBeGreaterThanOrEqual(0);
    }
  });

  it("classifies health bands green/orange/red from the existing statuses", () => {
    expect(healthBand("ok")).toBe("high");
    expect(healthBand("upcoming")).toBe("high");
    expect(healthBand("dueSoon")).toBe("mid");
    expect(healthBand("due")).toBe("low");
    expect(healthBand("overdue")).toBe("low");
    expect(healthBand("inspectionRequired")).toBe("low");
  });

  it("orders overdue < due < dueSoon = inspection < upcoming < ok", () => {
    expect(urgencyRank("overdue")).toBeLessThan(urgencyRank("due"));
    expect(urgencyRank("due")).toBeLessThan(urgencyRank("dueSoon"));
    expect(urgencyRank("dueSoon")).toBe(urgencyRank("inspectionRequired"));
    expect(urgencyRank("inspectionRequired")).toBeLessThan(urgencyRank("upcoming"));
    expect(urgencyRank("upcoming")).toBeLessThan(urgencyRank("ok"));
  });

  it("sorts by urgency then remaining percent", () => {
    const overdue = { status: "overdue" as MaintenanceStatus, remainingPercent: 0 };
    const due = { status: "due" as MaintenanceStatus, remainingPercent: 2 };
    const dueSooner = { status: "dueSoon" as MaintenanceStatus, remainingPercent: 15 };
    const dueLater = { status: "dueSoon" as MaintenanceStatus, remainingPercent: 19 };
    expect(compareByUrgency(overdue, due)).toBeLessThan(0);
    expect(compareByUrgency(dueSooner, dueLater)).toBeLessThan(0);
    expect(compareByUrgency(dueLater, dueSooner)).toBeGreaterThan(0);
  });

  it("puts inspection items (no percent) last within their rank", () => {
    const inspection = { status: "dueSoon" as MaintenanceStatus, remainingPercent: null };
    const dueSoon = { status: "dueSoon" as MaintenanceStatus, remainingPercent: 10 };
    expect(compareByUrgency(inspection, dueSoon)).toBeGreaterThan(0);
  });

  it("buckets statuses for the dashboard summary (§30)", () => {
    expect(summaryBucket("overdue")).toBe("overdue");
    expect(summaryBucket("due")).toBe("dueSoon");
    expect(summaryBucket("dueSoon")).toBe("dueSoon");
    expect(summaryBucket("inspectionRequired")).toBe("dueSoon");
    expect(summaryBucket("ok")).toBe("ok");
    expect(summaryBucket("upcoming")).toBe("ok");
  });
});

describe("display mode typing", () => {
  it("accepts every DisplayMode value", () => {
    const modes: DisplayMode[] = ["auto", "km", "time", "both"];
    const c = calc({ remainingKm: 100, remainingDays: 10, primaryCriterion: "km" });
    for (const mode of modes) {
      expect(resolvePrimaryMetric(c, mode)).toBeDefined();
    }
  });
});