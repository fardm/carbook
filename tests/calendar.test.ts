import { describe, expect, it } from "vitest";
import { dayAfterIso, googleCalendarUrl, isoToGoogleDate } from "../src/ui/calendar";

describe("isoToGoogleDate", () => {
  it("converts ISO dates to the YYYYMMDD render format", () => {
    expect(isoToGoogleDate("2026-09-10")).toBe("20260910");
    expect(isoToGoogleDate("2026-01-05")).toBe("20260105");
  });
});

describe("dayAfterIso", () => {
  it("adds one day across month and year boundaries", () => {
    expect(dayAfterIso("2026-09-10")).toBe("2026-09-11");
    expect(dayAfterIso("2026-09-30")).toBe("2026-10-01");
    expect(dayAfterIso("2026-12-31")).toBe("2027-01-01");
    expect(dayAfterIso("2028-02-28")).toBe("2028-02-29"); // leap year
  });
});

describe("googleCalendarUrl", () => {
  it("builds a render URL with action=TEMPLATE and an all-day date range", () => {
    const url = googleCalendarUrl({ title: "روغن موتور", date: "2026-09-10" });
    expect(url.startsWith("https://calendar.google.com/calendar/render?")).toBe(true);
    expect(url).toContain("action=TEMPLATE");
    // All-day events span date → next day (exclusive end).
    expect(url).toContain("dates=20260910/20260911");
  });

  it("URL-encodes the title and details", () => {
    const url = googleCalendarUrl({
      title: "تعویض روغن & فیلتر (A/B)",
      date: "2026-09-10",
      details: "یادداشت: روغن 10W-40\nبر اساس دفترچه",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("text")).toBe("تعویض روغن & فیلتر (A/B)");
    expect(parsed.searchParams.get("details")).toBe("یادداشت: روغن 10W-40\nبر اساس دفترچه");
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
  });

  it("omits details when not provided", () => {
    const url = googleCalendarUrl({ title: "x", date: "2026-09-10" });
    expect(url).not.toContain("details=");
  });

  it("supports timed events when allDay is false", () => {
    const url = googleCalendarUrl({ title: "x", date: "2026-09-10", allDay: false });
    expect(url).toContain("dates=20260910T090000/20260910T100000");
  });
});
