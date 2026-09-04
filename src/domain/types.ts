/**
 * Application data model (PROJECT_PLAN §9–§18, §39).
 *
 * Only facts are persisted — derived values such as remaining life, status,
 * or the current odometer are computed elsewhere (§4, §10).
 *
 * Dates: user-facing events (services, inspections, odometer readings) use
 * date-only ISO strings "yyyy-mm-dd". Creation timestamps use full ISO
 * datetime strings. ISO strings compare lexicographically, so sorting by
 * (date, createdAt) needs no date parsing.
 */

/** Fuel type values (extensible union). */
export type FuelType = "gasoline" | "diesel" | "hybrid" | "electric" | "cng" | "lpg" | "other";

/** Vehicle model (§9). `currentOdometer` is NOT stored — it is derived from
 * odometer history (§10). */
export interface Vehicle {
  id: string;
  name: string;
  make: string;
  model: string;
  /** Model year, e.g. 2019. Null when unknown. */
  year: number | null;
  fuelType: FuelType | null;
  /** km/day estimate used ONLY for estimating future dates (§11). */
  averageDailyDistance: number | null;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

/** A recorded odometer reading (§10). Readings are never discarded. */
export interface OdometerReading {
  id: string;
  /** "yyyy-mm-dd". */
  date: string;
  /** Odometer value in km. */
  odometer: number;
  createdAt: string; // ISO datetime
}

/** Display preference for the primary metric (§26). */
export type DisplayMode = "auto" | "km" | "time" | "both";

/** Criterion combination logic (§15). The MVP supports only "any": the first
 * criterion reached determines the due state (§25). */
export type TriggerLogic = "any";

/**
 * Maintenance rule (§15–§16). Distance and time criteria are independent and
 * optional; `inspectionBased` items report condition/status instead of
 * fabricated remaining life (§16, §28).
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
  /** True for inspection-based items (brake pads, discs, tires, belts …). */
  inspectionBased: boolean;
}

/** An active maintenance item (§14). Separate from the catalog templates. */
export interface MaintenanceItem {
  id: string;
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
  /** "yyyy-mm-dd". */
  date: string;
  /** Odometer at service time in km; null when unknown. */
  odometer: number | null;
  notes: string;
  /** Optional cost. */
  cost: number | null;
  createdAt: string; // ISO datetime
}

/** Inspection condition values (§36). */
export type InspectionCondition = "good" | "watch" | "replaceSoon" | "replaceNow";

/** An inspection event for an inspection-based item (§18, §36). */
export interface InspectionRecord {
  id: string;
  maintenanceItemId: string;
  /** "yyyy-mm-dd". */
  date: string;
  odometer: number | null;
  condition: InspectionCondition | null;
  /** Optional measurement, e.g. brake pad thickness in mm. */
  measurement: number | null;
  notes: string;
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

export interface Settings {
  statusThresholds: StatusThresholds;
  /** "system" follows the OS `prefers-color-scheme`; light/dark override it. */
  theme: ThemePreference;
  /** Calendar used for date display + date input throughout the app. */
  calendar: CalendarPreference;
}

/** Versioned application dataset (§39). The single persisted structure. */
export interface Dataset {
  /** Schema version; migrated on load (see persistence/repository.ts). */
  version: number;
  /** ISO datetime of the last JSON export; null until the first export (§41). */
  exportedAt: string | null;
  vehicle: Vehicle | null;
  odometerHistory: OdometerReading[];
  maintenanceItems: MaintenanceItem[];
  serviceHistory: ServiceRecord[];
  inspectionHistory: InspectionRecord[];
  settings: Settings;
}