/**
 * Solar Hijri (Jalali / Persian) calendar — pure conversion logic.
 *
 * This is the ONLY place Gregorian ↔ Jalali conversion lives; everything
 * else in the app converts through here. The algorithm is the standard
 * Jalaali algorithm (jalaali-js / Kazimierz M. Borkowski's method) — a
 * table-based 33-year cycle with astronomical leap-year corrections — and
 * is exact for the range the app needs (vehicle years 1900–2100 Gregorian
 * ≈ 1278–1479 Jalali).
 *
 * Internal dates are stored as Gregorian ISO strings ("yyyy-mm-dd"); this
 * module converts only at input/display boundaries (§3 of the calendar
 * requirements).
 */

/** y/m/d of a Jalali date (jy = Jalali year, jm = month 1–12, jd = day). */
export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

/** y/m/d of a Gregorian date. */
export interface GregorianDate {
  gy: number;
  gm: number;
  gd: number;
}

/** Persian names of the Jalali months (فروردین … اسفند). */
export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

/** Persian names of the Gregorian months (ژانویه … دسامبر). */
export const GREGORIAN_MONTHS = [
  "ژانویه",
  "فوریه",
  "مارس",
  "آوریل",
  "مه",
  "ژوئن",
  "ژوئیه",
  "اوت",
  "سپتامبر",
  "اکتبر",
  "نوامبر",
  "دسامبر",
] as const;

/** Short weekday names for the grid header, starting Saturday (Iranian
 * convention: شنبه is the first day of the week). */
export const WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;

/* --- Core algorithm (jalaali-js, MIT; Borkowski) --- */

/** Start years of the 33-year leap cycles (Jalali years). */
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178,
];

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

/** Gregorian y/m/d → fixed day number (proleptic Julian day variant). */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Fixed day number → Gregorian y/m/d. */
function d2g(jdn: number): GregorianDate {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

interface JalCal {
  /** 0 when `jy` is a leap year; otherwise years since the last leap. */
  leap: number;
  /** Corresponding Gregorian year. */
  gy: number;
  /** Day of March (Gregorian) on which Nowruz (1 Farvardin) of `jy` falls. */
  march: number;
}

/** Calendar metadata for a Jalali year: Nowruz date + leap offset. */
function jalCal(jy: number): JalCal {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm: number;
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Jalali y/m/d → fixed day number. */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** Fixed day number → Jalali y/m/d. */
function d2j(jdn: number): JalaliDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

/* --- Public conversion API --- */

/** Gregorian y/m/d → Jalali y/m/d. */
export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  return d2j(g2d(gy, gm, gd));
}

/** Jalali y/m/d → Gregorian y/m/d. The input MUST be a valid Jalali date
 * (call parseJalaliIso or check daysInJalaliMonth first); out-of-range days
 * silently roll into the next month. */
export function jalaliToGregorian(jy: number, jm: number, jd: number): GregorianDate {
  return d2g(j2d(jy, jm, jd));
}

/** True when the Jalali year has 366 days (Esfand has 30 days). */
export function isLeapJalaliYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

/** Days in a Jalali month: 31 for months 1–6, 30 for 7–11, 29/30 for
 * Esfand (12) depending on the leap year. */
export function daysInJalaliMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

/** Strict "jy-jm-jd" check (2-digit month/day) that also validates the day
 * against the real Jalali month length (leap-aware). */
export function parseJalaliIso(iso: string): JalaliDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (jy < 1 || jy > 3177 || jm < 1 || jm > 12 || jd < 1) return null;
  if (jd > daysInJalaliMonth(jy, jm)) return null;
  return { jy, jm, jd };
}