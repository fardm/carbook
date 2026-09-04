/**
 * Centralized calendar system (§3 of the calendar requirements): the single
 * source of truth for Gregorian ↔ Solar Hijri conversion, ISO parsing /
 * arithmetic, calendar-aware formatting, and month-grid math used by the
 * date picker. Views and the picker widget import from here (or from the
 * thin ui/format re-export).
 */
export {
  daysInJalaliMonth,
  gregorianToJalali,
  GREGORIAN_MONTHS,
  isLeapJalaliYear,
  jalaliToGregorian,
  JALALI_MONTHS,
  parseJalaliIso,
  WEEKDAYS_SHORT,
  type GregorianDate,
  type JalaliDate,
} from "./jalali";
export {
  addDays,
  addMonths,
  compareIso,
  dayNumberToIso,
  diffDays,
  isoToDayNumber,
  isValidIso,
  parseIso,
  todayIso,
  toIso,
  type IsoParts,
} from "./dates";
export {
  daysInMonth,
  firstDayOfMonthIso,
  monthGrid,
  monthName,
  weekdayOf,
  type MonthGrid,
  type MonthGridCell,
} from "./grid";
export {
  currentCalendar,
  faDigits,
  formatDate,
  formatDateTime,
  formatIso,
  gregorianIsoToJalaliIso,
  jalaliIsoToGregorianIso,
  toCalendarIso,
} from "./format";