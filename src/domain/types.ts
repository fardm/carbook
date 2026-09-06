/**
 * Application data model (PROJECT_PLAN §9–§18, §39).
 *
 * Only facts are persisted — derived values such as remaining life, status,
 * or the current odometer are computed elsewhere (§4, §10).
 *
 * Dates: user-facing events (services, odometer readings) use
 * date-only ISO strings "yyyy-mm-dd". Creation timestamps use full ISO
 * datetime strings. ISO strings compare lexicographically, so sorting by
 * (date, createdAt) needs no date parsing.
 */

/** Fuel type values (extensible union). */
export type FuelType = "gasoline" | "diesel" | "hybrid" | "electric" | "cng" | "lpg" | "other";

/** A vehicle in the user's garage (multi-vehicle §9). Only facts are stored;
 * the current odometer is a direct field — odometer history is no longer
 * kept (mileage is updated in place via بروزرسانی کیلومتر). */
export interface Vehicle {
  id: string;
  name: string;
  make: string;
  model: string;
  /** Production year — may be Solar Hijri (e.g. 1390) OR Gregorian
   * (1900–2100). Null when unknown. */
  year: number | null;
  fuelType: FuelType | null;
  /** Approximate km/year used ONLY for estimating future dates (§11). */
  averageAnnualDistance: number | null;
  /** Current odometer in km; null until the user records one. */
  currentOdometer: number | null;
  /** ISO datetime of the last mileage update (بروزرسانی کیلومتر); null until
   * the user records one. A single timestamp — NOT an update history/log. */
  odometerUpdatedAt: string | null;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

/** Display preference for the primary metric (§26). */
export type DisplayMode = "auto" | "km" | "time" | "both";

/** Criterion combination logic (§15). The MVP supports only "any": the first
 * criterion reached determines the due state (§25). */
export type TriggerLogic = "any";

/**
 * Maintenance rule (§15–§16). Distance and time criteria are independent and
 * optional; every item is tracked the same way (§14).
 */
export interface MaintenanceRule {
  /** Distance criterion in km; null when not applicable. */
  intervalKm: number | null;
  /** Time criterion in months; null when not applicable. */
  intervalMonths: number | null;
  /** How the criteria combine. */
  trigger: TriggerLogic;
  /** Display preference (§26). */
  displayMode: DisplayMode;
}

/** An active maintenance item (§14). Separate from the catalog templates.
 * Every item belongs to exactly one vehicle; `vehicleId` is null only when
 * the item is unassigned. */
export interface MaintenanceItem {
  id: string;
  /** Owning vehicle; null = unassigned item. */
  vehicleId: string | null;
  /** Catalog template id (Phase 5); null for custom items (§14, §37). */
  catalogId: string | null;
  /** Display name — a localized snapshot the user can edit (§14, §37). */
  name: string;
  /** Language-independent category id, e.g. "engine" (Phase 5). */
  category: string;
  /** Lucide icon name (kebab-case). */
  icon: string;
  rule: MaintenanceRule;
  /** False once the user deactivates the item (§14). */
  active: boolean;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

/** A service / replacement event (§17, §35). */
export interface ServiceRecord {
  id: string;
  maintenanceItemId: string;
  /** Owning vehicle (the item's vehicle at record time); null when unassigned. */
  vehicleId: string | null;
  /** "yyyy-mm-dd". */
  date: string;
  /** Odometer at service time in km; null when unknown. */
  odometer: number | null;
  notes: string;
  /** Optional cost. */
  cost: number | null;
  createdAt: string; // ISO datetime
}

/** Configurable status thresholds (§29). Values are percentages of remaining
 * configured life. Defaults live in defaults.ts; semantics are applied by the
 * Phase 3 calculation engine. */
export interface StatusThresholds {
  /** Remaining life % at/below which an item becomes DUE_SOON. */
  dueSoonPercent: number;
  /** Remaining life % at/below which an item becomes DUE. */
  duePercent: number;
}

/** UI colour theme preference (Phase 12 polish, §45–§46). */
export type ThemePreference = "system" | "light" | "dark";

/** Global date/calendar system (Settings). "jalali" = Solar Hijri (شمسی),
 * the default; "gregorian" = میلادی. The preference only changes how dates
 * are displayed and entered — stored dates are always Gregorian ISO. */
export type CalendarPreference = "jalali" | "gregorian";

/** Currency used for recording/displaying service costs (Settings). The
 * setting only picks the unit in which entered amounts are stored and shown;
 * no conversion ever happens. */
export type Currency = "IRR" | "USD" | "EUR";

export interface Settings {
  statusThresholds: StatusThresholds;
  /** "system" follows the OS `prefers-color-scheme`; light/dark override it. */
  theme: ThemePreference;
  /** Calendar used for date display + date input throughout the app. */
  calendar: CalendarPreference;
  /** Currency for service cost entry/display (تومان default; no conversion). */
  currency: Currency;
  /** Default vehicle id — the Services page auto-selects it. Null = none. */
  defaultVehicleId: string | null;
}

/** What a reminder watches. "date_mileage" fires on whichever comes first. */
export type ReminderType = "date" | "mileage" | "date_mileage";

/** Recurrence policy (extensible union — add new members without reshaping). */
export type RepeatMode = "none" | "monthly" | "yearly" | "km";

/** A single notification lead time. Units are separated so each type stays
 * machine-comparable: days for date triggers, km for mileage triggers. */
export interface NotificationOffset {
  /** Days BEFORE the due date (date/date_mileage reminders). */
  days?: number;
  /** Kilometers BEFORE the due mileage (mileage/date_mileage reminders). */
  km?: number;
}

/**
 * A user reminder (یادآوری). Facts only — remaining days/km and status are
 * derived by the reminder engine, never persisted. Dates are Gregorian ISO
 * "yyyy-mm-dd" (same convention as every other stored date).
 */
export interface Reminder {
  id: string;
  /** Owning vehicle — every reminder belongs to exactly one vehicle. */
  vehicleId: string;
  title: string;
  /** Optional free-text note. */
  description: string;
  /** Linked maintenance item; null = standalone reminder. */
  serviceId: string | null;
  /** Which condition(s) the reminder watches. */
  type: ReminderType;
  /** Due date (date / date_mileage); null when the reminder has none. */
  dueDate: string | null;
  /** Due odometer in km (mileage / date_mileage); null when none. */
  dueMileage: number | null;
  /** Notification lead times (per reminder, user-configured). */
  notificationOffsets: NotificationOffset[];
  /** Recurrence policy. */
  repeat: RepeatMode;
  /** Repeat interval in km for repeat "km". */
  repeatEveryKm: number | null;
  /** False = the reminder is muted and shows as disabled everywhere. */
  enabled: boolean;
  /** ISO date of the LAST completed occurrence (base for the next repeat). */
  lastCompletedDate: string | null;
  /** Odometer of the LAST completed occurrence (base for repeat "km"). */
  lastCompletedMileage: number | null;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

/** Versioned application dataset (§39). The single persisted structure. */
export interface Dataset {
  /** Schema version — v10 adds reminders; older versions are not migrated. */
  version: number;
  /** ISO datetime of the last JSON export; null until the first export (§41). */
  exportedAt: string | null;
  /** All vehicles (multi-vehicle). */
  vehicles: Vehicle[];
  maintenanceItems: MaintenanceItem[];
  serviceHistory: ServiceRecord[];
  /** User reminders (یادآوری‌ها) — added in v10 alongside the existing data. */
  reminders: Reminder[];
  settings: Settings;
}