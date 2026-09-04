import { CURRENT_VERSION, defaultDataset } from "../domain/defaults";
import type { Dataset, Settings } from "../domain/types";

/**
 * Centralized persistence layer (§39): the whole dataset lives under ONE
 * localStorage key as a versioned JSON envelope. Full structural validation
 * of user-imported data is Phase 10; loading here is defensive only — corrupt
 * or unsupported storage must never crash the app.
 */

export const STORAGE_KEY = "car-maintenance-tracker.dataset";

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryBackend(): StorageBackend {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Real localStorage in the browser; an in-memory fallback elsewhere (tests). */
export function browserStorage(): StorageBackend {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  return ls ?? memoryBackend();
}

export interface Repository {
  load(): Dataset;
  save(dataset: Dataset): void;
  clear(): void;
}

export function createRepository(backend: StorageBackend): Repository {
  return {
    load(): Dataset {
      const raw = backend.getItem(STORAGE_KEY);
      if (raw == null) return defaultDataset();
      return loadFromString(raw);
    },
    save(dataset: Dataset): void {
      backend.setItem(STORAGE_KEY, JSON.stringify(stampVersion(dataset)));
    },
    clear(): void {
      backend.removeItem(STORAGE_KEY);
    },
  };
}

/** Parses and migrates a stored JSON string into a valid Dataset. */
export function loadFromString(raw: string): Dataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnInvalid("not valid JSON");
    return defaultDataset();
  }

  if (!isRecord(parsed)) {
    warnInvalid("not an object");
    return defaultDataset();
  }
  if (typeof parsed.version !== "number") {
    warnInvalid("missing numeric version");
    return defaultDataset();
  }
  if (parsed.version > CURRENT_VERSION) {
    console.warn(
      `[persistence] Stored data version ${parsed.version} is newer than supported ${CURRENT_VERSION}; starting fresh.`,
    );
    return defaultDataset();
  }

  const migrated = migrateRaw(parsed);
  if (!migrated.ok) {
    warnInvalid(migrated.reason);
    return defaultDataset();
  }

  return normalize(migrated.value);
}

export type MigrateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Walks the migration table from the object's own version up to
 * CURRENT_VERSION. Shared by defensive loading (loadFromString) and the
 * strict Phase 10 import validator — one migration path for both.
 */
export function migrateRaw(raw: Record<string, unknown>): MigrateResult {
  if (typeof raw.version !== "number") {
    return { ok: false, reason: "missing numeric version" };
  }
  if (raw.version > CURRENT_VERSION) {
    return { ok: false, reason: `version ${raw.version} newer than supported` };
  }
  let migrated: Record<string, unknown> = raw;
  for (let version = raw.version; version < CURRENT_VERSION; version += 1) {
    const step = migrations[version];
    if (!step) {
      return { ok: false, reason: `no migration path from version ${version}` };
    }
    migrated = step(migrated);
  }
  return { ok: true, value: migrated };
}

/**
 * Migration table: version → migration function, one step per version.
 * Version 0 is a placeholder for pre-schema data; normalize() repairs shape.
 */
const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  0: (raw) => raw,
  // v1 → v2 (Phase 12): the Settings gained a UI colour-theme preference.
  1: (raw) => {
    const settings = raw.settings;
    if (isRecord(settings) && !("theme" in settings)) {
      settings.theme = "system";
    }
    return raw;
  },
  // v2 → v3 (Calendar system): the Settings gained a global date/calendar
  // preference. Default = Solar Hijri (شمسی). Stored dates are untouched.
  2: (raw) => {
    const settings = raw.settings;
    if (isRecord(settings) && !("calendar" in settings)) {
      settings.calendar = "jalali";
    }
    return raw;
  },
  // v3 → v4 (Multi-vehicle): the single `vehicle` + `odometerHistory` become
  // `vehicles[]`. The current odometer is the latest reading (history is no
  // longer kept). Every maintenance item and record is linked to the vehicle
  // (null when no vehicle existed), so nothing is ever shared between cars.
  3: (raw) => {
    const vehicles: unknown[] = [];
    if (isRecord(raw.vehicle)) {
      const readings = Array.isArray(raw.odometerHistory) ? (raw.odometerHistory as unknown[]) : [];
      const sorted = [...readings].sort((a, b) =>
        isRecord(a) && isRecord(b)
          ? compareCreated(a, b)
          : 0,
      );
      const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
      const currentOdometer =
        latest != null && isRecord(latest) && typeof latest.odometer === "number"
          ? latest.odometer
          : null;
      vehicles.push({ ...raw.vehicle, currentOdometer });
    }
    const vehicleId = vehicles.length > 0 && isRecord(vehicles[0]) ? (vehicles[0].id as string) : null;
    const link = (collection: unknown): unknown[] =>
      Array.isArray(collection)
        ? collection.map((element) => (isRecord(element) ? { ...element, vehicleId } : element))
        : [];
    raw.vehicles = vehicles;
    raw.maintenanceItems = link(raw.maintenanceItems);
    raw.serviceHistory = link(raw.serviceHistory);
    raw.inspectionHistory = link(raw.inspectionHistory);
    delete raw.vehicle;
    delete raw.odometerHistory;
    return raw;
  },
  // v4 → v5 (Default vehicle): the Settings gained a `defaultVehicleId`
  // preference used to auto-select a vehicle on the Services page.
  4: (raw) => {
    const settings = raw.settings;
    if (isRecord(settings) && !("defaultVehicleId" in settings)) {
      settings.defaultVehicleId = null;
    }
    return raw;
  },
  // v5 → v6 (Mileage timestamp): each Vehicle records `odometerUpdatedAt` so
  // the vehicles page can show when the mileage was last updated. A single
  // timestamp — the odometer history/log stays removed.
  5: (raw) => {
    if (Array.isArray(raw.vehicles)) {
      raw.vehicles = raw.vehicles.map((vehicle) =>
        isRecord(vehicle) && vehicle.odometerUpdatedAt === undefined
          ? { ...vehicle, odometerUpdatedAt: null }
          : vehicle,
      );
    }
    return raw;
  },
  // v6 → v7 (Currency): the Settings gained a `currency` preference for
  // recording/displaying service costs. Default = تومان (IRR). Stored costs
  // are untouched — no conversion, the unit is only a display label.
  6: (raw) => {
    const settings = raw.settings;
    if (isRecord(settings) && !("currency" in settings)) {
      settings.currency = "IRR";
    }
    return raw;
  },
};

/** Sorts odometer readings for the v3→v4 migration by (date, createdAt). */
function compareCreated(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aDate = typeof a.date === "string" ? a.date : "";
  const bDate = typeof b.date === "string" ? b.date : "";
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  const aCreated = typeof a.createdAt === "string" ? a.createdAt : "";
  const bCreated = typeof b.createdAt === "string" ? b.createdAt : "";
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
  return 0;
}

/** Ensures the migrated object has the exact Dataset shape (§40 step 5). */
function normalize(raw: Record<string, unknown>): Dataset {
  const fallback = defaultDataset();
  return {
    version: CURRENT_VERSION,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : null,
    vehicles: Array.isArray(raw.vehicles)
      ? (withOdometerStamp(raw.vehicles) as Dataset["vehicles"])
      : [],
    maintenanceItems: withVehicleId(Array.isArray(raw.maintenanceItems) ? raw.maintenanceItems : []) as Dataset["maintenanceItems"],
    serviceHistory: withVehicleId(Array.isArray(raw.serviceHistory) ? raw.serviceHistory : []) as Dataset["serviceHistory"],
    inspectionHistory: withVehicleId(Array.isArray(raw.inspectionHistory) ? raw.inspectionHistory : []) as Dataset["inspectionHistory"],
    settings: normalizeSettings(raw.settings, fallback.settings),
  };
}

/** Defensive repair: every item/record carries a `vehicleId` (null default). */
function withVehicleId(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!isRecord(row)) return row;
    return row.vehicleId === undefined ? { ...row, vehicleId: null } : row;
  });
}

/** Defensive repair: every vehicle carries an `odometerUpdatedAt` (null). */
function withOdometerStamp(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!isRecord(row)) return row;
    return row.odometerUpdatedAt === undefined ? { ...row, odometerUpdatedAt: null } : row;
  });
}

const THEME_PREFERENCES = ["system", "light", "dark"];
const CALENDAR_PREFERENCES = ["jalali", "gregorian"];
const CURRENCIES = ["IRR", "USD", "EUR"];

function normalizeSettings(raw: unknown, fallback: Settings): Settings {
  if (!isRecord(raw)) return fallback;
  const thresholds = isRecord(raw.statusThresholds) ? raw.statusThresholds : {};
  return {
    statusThresholds: {
      dueSoonPercent:
        typeof thresholds.dueSoonPercent === "number"
          ? thresholds.dueSoonPercent
          : fallback.statusThresholds.dueSoonPercent,
      duePercent:
        typeof thresholds.duePercent === "number"
          ? thresholds.duePercent
          : fallback.statusThresholds.duePercent,
    },
    theme:
      typeof raw.theme === "string" && THEME_PREFERENCES.includes(raw.theme)
        ? (raw.theme as Settings["theme"])
        : fallback.theme,
    calendar:
      typeof raw.calendar === "string" && CALENDAR_PREFERENCES.includes(raw.calendar)
        ? (raw.calendar as Settings["calendar"])
        : fallback.calendar,
    currency:
      typeof raw.currency === "string" && CURRENCIES.includes(raw.currency)
        ? (raw.currency as Settings["currency"])
        : fallback.currency,
    defaultVehicleId:
      typeof raw.defaultVehicleId === "string" && raw.defaultVehicleId !== ""
        ? raw.defaultVehicleId
        : null,
  };
}

/** Always persists with the current schema version stamped (§40). */
function stampVersion(dataset: Dataset): Dataset {
  return { ...dataset, version: CURRENT_VERSION };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function warnInvalid(reason: string): void {
  console.warn(`[persistence] Ignoring stored data (${reason}); starting fresh.`);
}