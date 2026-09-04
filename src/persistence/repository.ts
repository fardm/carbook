import { CURRENT_VERSION, defaultDataset } from "../domain/defaults";
import type { Dataset, Settings, Vehicle } from "../domain/types";

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
};

/** Ensures the migrated object has the exact Dataset shape (§40 step 5). */
function normalize(raw: Record<string, unknown>): Dataset {
  const fallback = defaultDataset();
  return {
    version: CURRENT_VERSION,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : null,
    vehicle: isRecord(raw.vehicle) ? (raw.vehicle as unknown as Vehicle) : null,
    odometerHistory: Array.isArray(raw.odometerHistory)
      ? (raw.odometerHistory as Dataset["odometerHistory"])
      : [],
    maintenanceItems: Array.isArray(raw.maintenanceItems)
      ? (raw.maintenanceItems as Dataset["maintenanceItems"])
      : [],
    serviceHistory: Array.isArray(raw.serviceHistory)
      ? (raw.serviceHistory as Dataset["serviceHistory"])
      : [],
    inspectionHistory: Array.isArray(raw.inspectionHistory)
      ? (raw.inspectionHistory as Dataset["inspectionHistory"])
      : [],
    settings: normalizeSettings(raw.settings, fallback.settings),
  };
}

const THEME_PREFERENCES = ["system", "light", "dark"];

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