import { describe, expect, it } from "vitest";
import {
  daysInJalaliMonth,
  gregorianToJalali,
  isLeapJalaliYear,
  jalaliToGregorian,
  parseJalaliIso,
} from "../src/domain/calendar";

describe("gregorianToJalali — known dates", () => {
  it("Nowruz (1 Farvardin) of 1405 is 21 March 2026", () => {
    expect(gregorianToJalali(2026, 3, 21)).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });

  it("13 September 2026 is 13 Shahrivar 1405", () => {
    expect(gregorianToJalali(2026, 9, 4)).toEqual({ jy: 1405, jm: 6, jd: 13 });
  });

  it("the day before Nowruz 1405 is 29 Esfand 1404 (non-leap)", () => {
    expect(gregorianToJalali(2026, 3, 20)).toEqual({ jy: 1404, jm: 12, jd: 29 });
  });

  it("leap-day 2024-02-29 is 10 Esfand 1402", () => {
    expect(gregorianToJalali(2024, 2, 29)).toEqual({ jy: 1402, jm: 12, jd: 10 });
  });

  it("the Iranian revolution: 22 Bahman 1357 = 11 Feb 1979", () => {
    expect(gregorianToJalali(1979, 2, 11)).toEqual({ jy: 1357, jm: 11, jd: 22 });
  });

  it("1 Jan 2000 = 11 Dey 1378", () => {
    expect(gregorianToJalali(2000, 1, 1)).toEqual({ jy: 1378, jm: 10, jd: 11 });
  });
});

describe("jalaliToGregorian — known dates", () => {
  it("converts Nowruz back to 21 March 2026", () => {
    expect(jalaliToGregorian(1405, 1, 1)).toEqual({ gy: 2026, gm: 3, gd: 21 });
  });

  it("converts 13 Shahrivar 1405 back to 4 Sep 2026", () => {
    expect(jalaliToGregorian(1405, 6, 13)).toEqual({ gy: 2026, gm: 9, gd: 4 });
  });

  it("Sizdah Bedar 1405 (13 Farvardin) = 2 April 2026", () => {
    expect(jalaliToGregorian(1405, 1, 13)).toEqual({ gy: 2026, gm: 4, gd: 2 });
  });

  it("leap Esfand 1403: 30 Esfand 1403 = 20 March 2024", () => {
    expect(jalaliToGregorian(1403, 12, 30)).toEqual({ gy: 2024, gm: 3, gd: 20 });
  });
});

describe("round trips", () => {
  it("every day of 1900–2100 round-trips through both conversions", () => {
    for (let gy = 1900; gy <= 2100; gy += 1) {
      for (let gm = 1; gm <= 12; gm += 1) {
        const days = new Date(Date.UTC(gy, gm, 0)).getUTCDate();
        for (let gd = 1; gd <= days; gd += 1) {
          const j = gregorianToJalali(gy, gm, gd);
          const back = jalaliToGregorian(j.jy, j.jm, j.jd);
          expect(back).toEqual({ gy, gm, gd });
        }
      }
    }
  });
});

describe("leap years", () => {
  it("knows the leap status of key Jalali years", () => {
    expect(isLeapJalaliYear(1403)).toBe(true); // 366 days (Esfand 30)
    expect(isLeapJalaliYear(1404)).toBe(false);
    expect(isLeapJalaliYear(1402)).toBe(false);
  });

  it("month lengths: 1–6 → 31, 7–11 → 30, Esfand → 29/30 by leap", () => {
    for (let jm = 1; jm <= 6; jm += 1) {
      expect(daysInJalaliMonth(1405, jm)).toBe(31);
    }
    for (let jm = 7; jm <= 11; jm += 1) {
      expect(daysInJalaliMonth(1405, jm)).toBe(30);
    }
    expect(daysInJalaliMonth(1403, 12)).toBe(30); // leap
    expect(daysInJalaliMonth(1404, 12)).toBe(29); // non-leap
  });

  it("year lengths add up to 365/366 days", () => {
    const yearDays = (jy: number): number =>
      Array.from({ length: 12 }, (_, i) => daysInJalaliMonth(jy, i + 1)).reduce((a, b) => a + b, 0);
    expect(yearDays(1403)).toBe(366);
    expect(yearDays(1404)).toBe(365);
  });
});

describe("parseJalaliIso — validation", () => {
  it("accepts valid Jalali ISO dates", () => {
    expect(parseJalaliIso("1405-01-01")).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(parseJalaliIso("1403-12-30")).toEqual({ jy: 1403, jm: 12, jd: 30 }); // leap Esfand
  });

  it("rejects a month 13", () => {
    expect(parseJalaliIso("1405-13-01")).toBeNull();
  });

  it("rejects day 31 in a 30-day month", () => {
    expect(parseJalaliIso("1405-07-31")).toBeNull();
    expect(parseJalaliIso("1405-06-31")).toBeNull();
    expect(parseJalaliIso("1405-06-30")).toEqual({ jy: 1405, jm: 6, jd: 30 });
  });

  it("rejects 30 Esfand in a non-leap year but allows it in a leap year", () => {
    expect(parseJalaliIso("1404-12-30")).toBeNull();
    expect(parseJalaliIso("1403-12-30")).toEqual({ jy: 1403, jm: 12, jd: 30 });
  });

  it("rejects malformed strings", () => {
    expect(parseJalaliIso("1405/01/01")).toBeNull();
    expect(parseJalaliIso("1405-1-1")).toBeNull();
    expect(parseJalaliIso("")).toBeNull();
    expect(parseJalaliIso("1405-01-00")).toBeNull();
  });
});