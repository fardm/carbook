import { describe, expect, it } from "vitest";
import { addMonths, dayToIso, isoToDay, todayIso } from "../src/domain/maintenance";

describe("calendar dates", () => {
  it("round-trips ISO dates through day numbers", () => {
    for (const iso of ["2026-01-01", "2024-02-29", "2026-12-31", "1999-07-15"]) {
      expect(dayToIso(isoToDay(iso))).toBe(iso);
    }
  });

  it("isoToDay counts exact day differences", () => {
    expect(isoToDay("2026-07-01") - isoToDay("2026-04-01")).toBe(91);
    expect(isoToDay("2026-04-01") - isoToDay("2026-01-01")).toBe(90);
  });

  it("addMonths handles year and month boundaries", () => {
    expect(addMonths("2026-01-01", 6)).toBe("2026-07-01");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("addMonths clamps to the last day of short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("addMonths respects leap years", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2023-02-28", 12)).toBe("2024-02-28");
  });

  it("todayIso returns a well-formed yyyy-mm-dd string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});