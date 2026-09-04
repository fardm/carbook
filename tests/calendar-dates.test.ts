import { describe, expect, it } from "vitest";
import {
  addMonths,
  currentCalendar,
  formatDate,
  formatDateTime,
  gregorianIsoToJalaliIso,
  jalaliIsoToGregorianIso,
  monthGrid,
  weekdayOf,
} from "../src/domain/calendar";
import { defaultDataset } from "../src/domain/defaults";
import { store } from "../src/state/store";

describe("formatDate — display in each calendar", () => {
  it("formats ISO dates in Solar Hijri with Persian month names", () => {
    expect(formatDate("2026-09-04", "jalali")).toBe("۱۳ شهریور ۱۴۰۵");
    expect(formatDate("2026-03-21", "jalali")).toBe("۱ فروردین ۱۴۰۵");
    expect(formatDate("2026-03-20", "jalali")).toBe("۲۹ اسفند ۱۴۰۴");
  });

  it("formats ISO dates in Gregorian with Persian month names", () => {
    expect(formatDate("2026-09-04", "gregorian")).toBe("۴ سپتامبر ۲۰۲۶");
    expect(formatDate("2026-03-21", "gregorian")).toBe("۲۱ مارس ۲۰۲۶");
    expect(formatDate("2024-02-29", "gregorian")).toBe("۲۹ فوریه ۲۰۲۴");
  });

  it("returns an empty string for invalid ISO input", () => {
    expect(formatDate("not-a-date", "jalali")).toBe("");
    expect(formatDate("2026-02-30", "gregorian")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("formats a local datetime in both calendars", () => {
    // Built from local components so the assertion is timezone-independent.
    const iso = new Date(2026, 8, 4, 15, 15).toISOString();
    expect(formatDateTime(iso, "jalali")).toBe("۱۳ شهریور ۱۴۰۵، ۱۵:۱۵");
    expect(formatDateTime(iso, "gregorian")).toBe("۴ سپتامبر ۲۰۲۶، ۱۵:۱۵");
  });
});

describe("input-boundary conversion", () => {
  it("converts a Jalali date chosen by the user into the stored Gregorian ISO", () => {
    expect(jalaliIsoToGregorianIso("1405-01-01")).toBe("2026-03-21");
    expect(jalaliIsoToGregorianIso("1405-06-13")).toBe("2026-09-04");
    expect(jalaliIsoToGregorianIso("1404-12-30")).toBeNull(); // invalid (non-leap Esfand)
  });

  it("converts a stored Gregorian ISO back to Jalali", () => {
    expect(gregorianIsoToJalaliIso("2026-03-21")).toBe("1405-01-01");
    expect(gregorianIsoToJalaliIso("2026-09-04")).toBe("1405-06-13");
  });

  it("Jalali data entered by the user displays correctly in Gregorian later", () => {
    // The user picks 13 شهریور ۱۴۰۵ → stored as 2026-09-04 → shown in Gregorian.
    const stored = jalaliIsoToGregorianIso("1405-06-13");
    expect(stored).toBe("2026-09-04");
    expect(formatDate(stored!, "gregorian")).toBe("۴ سپتامبر ۲۰۲۶");
  });
});

describe("month grid math", () => {
  it("فروردین ۱۴۰۵ starts on Saturday 21 March 2026 with no leading blanks", () => {
    expect(weekdayOf("2026-03-21")).toBe(0); // Saturday
    const grid = monthGrid("jalali", 1405, 1, "2026-09-04");
    expect(grid.days).toBe(31);
    expect(grid.lead).toBe(0);
    expect(grid.cells[0]).toEqual({ iso: "2026-03-21", day: 1, isToday: false });
    expect(grid.cells[12].iso).toBe("2026-04-02"); // Sizdah Bedar
  });

  it("Gregorian February 2024 (leap) has 29 days and 5 leading blanks (Thursday)", () => {
    const grid = monthGrid("gregorian", 2024, 2, "2026-09-04");
    expect(grid.days).toBe(29);
    expect(grid.lead).toBe(5); // 1 Feb 2024 is a Thursday; Saturday-first weeks
    // Day cells start at day 1; the renderer adds `lead` blanks in front.
    expect(grid.cells[0].iso).toBe("2024-02-01");
    expect(grid.cells[0].day).toBe(1);
    expect(grid.cells[28].iso).toBe("2024-02-29");
  });

  it("isToday highlights only the matching cell", () => {
    const grid = monthGrid("jalali", 1405, 6, "2026-09-04");
    const today = grid.cells.find((cell) => cell.isToday);
    expect(today?.iso).toBe("2026-09-04");
    expect(today?.day).toBe(13);
  });

  it("esfand 1404 (non-leap) shows 29 days", () => {
    expect(monthGrid("jalali", 1404, 12, "2026-09-04").days).toBe(29);
  });
});

describe("calendar switching — same stored date, different presentation", () => {
  it("the same ISO date renders differently per calendar without changing the value", () => {
    const iso = "2026-09-04";
    expect(formatDate(iso, "jalali")).toBe("۱۳ شهریور ۱۴۰۵");
    expect(formatDate(iso, "gregorian")).toBe("۴ سپتامبر ۲۰۲۶");
  });

  it("the store preference drives the default formatDate output", () => {
    const original = store.get();
    try {
      const gregorian = defaultDataset();
      gregorian.settings.calendar = "gregorian";
      store.replace(gregorian);
      expect(currentCalendar()).toBe("gregorian");
      expect(formatDate("2026-09-04")).toBe("۴ سپتامبر ۲۰۲۶");

      const jalali = defaultDataset();
      jalali.settings.calendar = "jalali";
      store.replace(jalali);
      expect(currentCalendar()).toBe("jalali");
      expect(formatDate("2026-09-04")).toBe("۱۳ شهریور ۱۴۰۵");
    } finally {
      store.replace(original);
    }
  });
});

describe("calculations stay calendar-independent", () => {
  it("a service on 29 اسفند ۱۴۰۴ + 6 months lands on the same real date in both calendars", () => {
    // User enters the service date in Jalali; it is stored as Gregorian ISO.
    const serviceIso = jalaliIsoToGregorianIso("1404-12-29")!;
    expect(serviceIso).toBe("2026-03-20");
    const dueIso = addMonths(serviceIso, 6); // engine arithmetic on the stored ISO
    expect(dueIso).toBe("2026-09-20");
    // The same real due date, presented in either calendar:
    expect(formatDate(dueIso, "jalali")).toBe("۲۹ شهریور ۱۴۰۵");
    expect(formatDate(dueIso, "gregorian")).toBe("۲۰ سپتامبر ۲۰۲۶");
  });
});