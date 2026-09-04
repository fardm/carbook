import { describe, expect, it } from "vitest";
import {
  sortHistoryNewestFirst,
  validateInspectionRecordEntry,
  validateServiceRecordEntry,
} from "../src/domain/records";

const TODAY = "2026-09-04";

describe("validateServiceRecordEntry (§35)", () => {
  const valid = { date: "2026-08-20", odometer: 104500, cost: null };

  it("accepts a valid service event with date and odometer", () => {
    expect(validateServiceRecordEntry(valid, { today: TODAY })).toEqual([]);
  });

  it("accepts a date-only event (odometer + cost unknown)", () => {
    expect(validateServiceRecordEntry({ date: "2026-08-20", odometer: null, cost: null }, { today: TODAY })).toEqual([]);
  });

  it("rejects missing, malformed, and future dates", () => {
    expect(validateServiceRecordEntry({ ...valid, date: "" }, { today: TODAY })).toContain("missingDate");
    expect(validateServiceRecordEntry({ ...valid, date: "2026-13-01" }, { today: TODAY })).toContain("invalidDate");
    expect(validateServiceRecordEntry({ ...valid, date: "2026-09-10" }, { today: TODAY })).toContain("futureDate");
  });

  it("rejects negative/decimal odometers but allows null", () => {
    expect(validateServiceRecordEntry({ ...valid, odometer: -5 }, { today: TODAY })).toContain("invalidOdometer");
    expect(validateServiceRecordEntry({ ...valid, odometer: 12.5 }, { today: TODAY })).toContain("invalidOdometer");
    expect(validateServiceRecordEntry({ ...valid, odometer: null }, { today: TODAY })).toEqual([]);
  });

  it("rejects negative cost but allows zero/decimal/null", () => {
    expect(validateServiceRecordEntry({ ...valid, cost: -1 }, { today: TODAY })).toContain("invalidCost");
    expect(validateServiceRecordEntry({ ...valid, cost: 0 }, { today: TODAY })).toEqual([]);
    expect(validateServiceRecordEntry({ ...valid, cost: 1500.5 }, { today: TODAY })).toEqual([]);
    expect(validateServiceRecordEntry({ ...valid, cost: null }, { today: TODAY })).toEqual([]);
  });
});

describe("validateInspectionRecordEntry (§36)", () => {
  const valid = {
    date: "2026-08-20",
    odometer: 104500,
    condition: "watch" as const,
    measurement: null,
  };

  it("accepts a valid inspection event with a condition", () => {
    expect(validateInspectionRecordEntry(valid, { today: TODAY })).toEqual([]);
  });

  it("rejects a missing condition (it drives the inspection status)", () => {
    expect(
      validateInspectionRecordEntry({ ...valid, condition: null }, { today: TODAY }),
    ).toContain("conditionRequired");
  });

  it("applies the same date rules as service events", () => {
    expect(validateInspectionRecordEntry({ ...valid, date: "" }, { today: TODAY })).toContain("missingDate");
    expect(validateInspectionRecordEntry({ ...valid, date: "2026-09-10" }, { today: TODAY })).toContain("futureDate");
  });

  it("rejects negative/decimal odometers but allows null", () => {
    expect(validateInspectionRecordEntry({ ...valid, odometer: -1 }, { today: TODAY })).toContain("invalidOdometer");
    expect(validateInspectionRecordEntry({ ...valid, odometer: 100.4 }, { today: TODAY })).toContain("invalidOdometer");
    expect(validateInspectionRecordEntry({ ...valid, odometer: null }, { today: TODAY })).toEqual([]);
  });

  it("accepts measurements (e.g. pad thickness in mm) only when non-negative", () => {
    expect(validateInspectionRecordEntry({ ...valid, measurement: 8.2 }, { today: TODAY })).toEqual([]);
    expect(validateInspectionRecordEntry({ ...valid, measurement: 0 }, { today: TODAY })).toEqual([]);
    expect(validateInspectionRecordEntry({ ...valid, measurement: -2 }, { today: TODAY })).toContain("invalidMeasurement");
  });
});

describe("sortHistoryNewestFirst", () => {
  const mk = (date: string, createdAt: string) => ({ date, createdAt });

  it("sorts by date descending", () => {
    const sorted = sortHistoryNewestFirst([mk("2026-01-01", "a"), mk("2026-03-03", "b"), mk("2026-02-02", "c")]);
    expect(sorted.map((r) => r.date)).toEqual(["2026-03-03", "2026-02-02", "2026-01-01"]);
  });

  it("breaks same-date ties by createdAt descending", () => {
    const sorted = sortHistoryNewestFirst([
      mk("2026-01-01", "2026-01-01T10:00:00Z"),
      mk("2026-01-01", "2026-01-01T08:00:00Z"),
    ]);
    expect(sorted.map((r) => r.createdAt)).toEqual(["2026-01-01T10:00:00Z", "2026-01-01T08:00:00Z"]);
  });

  it("does not mutate the input", () => {
    const input = [mk("2026-02-02", "a"), mk("2026-01-01", "b")];
    const copy = [...input];
    sortHistoryNewestFirst(input);
    expect(input).toEqual(copy);
  });
});
