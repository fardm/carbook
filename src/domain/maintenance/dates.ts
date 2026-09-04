/**
 * Calendar helpers for the maintenance engine — re-exported from the
 * centralized calendar module (src/domain/calendar) so all date arithmetic
 * in the app shares ONE implementation. Backwards-compatible names.
 */
export {
  addDays,
  addMonths,
  compareIso,
  dayNumberToIso as dayToIso,
  diffDays,
  isoToDayNumber as isoToDay,
  isValidIso,
  parseIso,
  todayIso,
  toIso,
  type IsoParts,
} from "../calendar/dates";