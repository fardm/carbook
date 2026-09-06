import { CURRENT_VERSION, defaultDataset } from "../domain/defaults";
import type { Dataset, Settings } from "../domain/types";
import { normalizeReminders } from "./reminder-normalize";

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

/**
 * Parses a stored JSON string into a valid Dataset. v8 is the only supported
 * schema version — no migration paths are maintained for older data, so
 * anything other than the current version is ignored defensively.
 */
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
  if (parsed.version !== CURRENT_VERSION) {
    // v9 → v10: reminders were added alongside the existing data. Existing
    // datasets migrate in place (an empty reminders array is appended) so
    // users never lose vehicles/services/settings across the update.
    if (parsed.version === CURRENT_VERSION - 1) {
      console.warn(
        `[persistence] Migrating stored data v${parsed.version} → v${CURRENT_VERSION} (adding reminders).`,
      );
      return normalize({ ...parsed, reminders: [] });
    }
    console.warn(
      `[persistence] Stored data version ${parsed.version} is not supported (current: ${CURRENT_VERSION}); starting fresh.`,
    );
    return defaultDataset();
  }

  return normalize(parsed);
}

/**
 * Ensures the parsed object has the exact Dataset shape (§40 step 5).
 * Reminders (v10) are defensively normalized per row so partially-shaped
 * stored data never crashes the feature.
 */
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
    reminders: normalizeReminders(raw.reminders),
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