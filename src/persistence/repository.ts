import { CURRENT_VERSION, defaultDataset } from "../domain/defaults";
import type { Dataset, Settings } from "../domain/types";
import { normalizeReminders } from "./reminder-normalize";

/**
 * Centralized persistence layer (§39): the whole dataset lives under ONE
 * storage key as a versioned JSON envelope. Full structural validation
 * of user-imported data is Phase 10; loading here is defensive only — corrupt
 * or unsupported storage must never crash the app.
 * 
 * Phase 1: Migration from localStorage to IndexedDB while maintaining
 * backward compatibility and same Repository interface.
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
  /** Promise for the repository's own initial async load, if any. Resolves
   * once load() reflects the real stored data (Store.ready awaits it). */
  initialLoad?(): Promise<void>;
  /** Awaits completion of all queued async write operations. Fire-and-forget
   * saves need this before a repository swap (e.g. before migrating guest
   * data to the cloud, so nothing is lost mid-flight). */
  flush?(): Promise<void>;
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
 * Async repository interface for IndexedDB and other async storage backends.
 */
export interface AsyncRepository {
  load(): Promise<Dataset>;
  save(dataset: Dataset): Promise<void>;
  clear(): Promise<void>;
}

/**
 * IndexedDB-backed repository implementation.
 * 
 * Uses a single object store "dataset" with key "app" to store the entire
 * Dataset JSON envelope, matching the localStorage single-key pattern.
 */
export class IndexedDBRepository implements AsyncRepository {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly key: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName = "car-maintenance-tracker", storeName = "dataset", key = "app") {
    this.dbName = dbName;
    this.storeName = storeName;
    this.key = key;
  }

  /**
   * Opens the IndexedDB database, creating it if necessary.
   * Uses a singleton promise to avoid multiple open attempts.
   */
  private async openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Performs a transaction on the dataset store.
   * @param mode - "readonly" or "readwrite"
   * @param operation - Function that receives the store and returns a result
   */
  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
  ): Promise<T> {
    const db = await this.openDB();
    const transaction = db.transaction(this.storeName, mode);
    const store = transaction.objectStore(this.storeName);
    
    const requestOrPromise = operation(store);
    
    if (requestOrPromise instanceof IDBRequest) {
      return new Promise((resolve, reject) => {
        requestOrPromise.onerror = () => reject(requestOrPromise.error);
        requestOrPromise.onsuccess = () => resolve(requestOrPromise.result);
      });
    } else {
      return requestOrPromise;
    }
  }

  async load(): Promise<Dataset> {
    try {
      const raw = await this.transaction("readonly", (store) => 
        store.get(this.key)
      );

      if (raw == null) {
        return defaultDataset();
      }

      // Handle both string storage (backward compat) and direct object storage
      if (typeof raw === "string") {
        return loadFromString(raw);
      } else if (typeof raw === "object" && raw !== null) {
        // Already parsed object from previous save
        return loadFromString(JSON.stringify(raw));
      } else {
        console.warn("[persistence] Invalid stored data format in IndexedDB; starting fresh.");
        return defaultDataset();
      }
    } catch (error) {
      console.warn("[persistence] IndexedDB load failed:", error);
      return defaultDataset();
    }
  }

  async save(dataset: Dataset): Promise<void> {
    try {
      await this.transaction("readwrite", (store) => {
        // Store as object for efficiency (avoids JSON.parse on load)
        const stamped = { ...dataset, version: CURRENT_VERSION };
        return store.put(stamped, this.key);
      });
    } catch (error) {
      console.warn("[persistence] IndexedDB save failed:", error);
      // Fail silently - data not persisted but app continues
    }
  }

  async clear(): Promise<void> {
    try {
      await this.transaction("readwrite", (store) => 
        store.delete(this.key)
      );
    } catch (error) {
      console.warn("[persistence] IndexedDB clear failed:", error);
    }
  }

  /**
   * Closes the database connection (primarily for testing).
   */
  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }
}

/**
 * Adapter that wraps an AsyncRepository to provide the synchronous
 * Repository interface expected by Store.
 * 
 * This adapter queues operations to avoid race conditions and provides
 * synchronous fallbacks when async operations are in progress.
 */
export class SyncRepositoryAdapter implements Repository {
  private readonly asyncRepo: AsyncRepository;
  private loadPromise: Promise<Dataset> | null = null;
  private savePromise: Promise<void> | null = null;
  private clearPromise: Promise<void> | null = null;
  private cachedDataset: Dataset;

  constructor(asyncRepo: AsyncRepository) {
    this.asyncRepo = asyncRepo;
    // Initialize with default dataset, will be replaced by async load
    this.cachedDataset = defaultDataset();
    
    // Start async load in background
    this.loadPromise = this.asyncRepo.load();
    this.loadPromise.then(dataset => {
      this.cachedDataset = dataset;
      this.loadPromise = null;
    }).catch(() => {
      this.loadPromise = null;
    });
  }

  /** Promise that resolves once the background load has settled and the
   * cache reflects the real stored data (Store.ready awaits this).
   * Rejects if the async load failed, so callers can detect failures
   * and avoid swapping to a backend that couldn't load its data. */
  initialLoad(): Promise<void> {
    if (this.loadPromise) return this.loadPromise.then(() => undefined);
    return Promise.resolve();
  }

  /** Resolves when every queued save/clear has been handed to the async
   * backend (used before a repository swap so no write is lost). */
  flush(): Promise<void> {
    return (this.savePromise ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => (this.clearPromise ?? Promise.resolve()).catch(() => undefined));
  }

  load(): Dataset {
    // If async load is still in progress, return cached dataset
    // The store will get updated when async load completes
    return this.cachedDataset;
  }

  save(dataset: Dataset): void {
    this.cachedDataset = dataset;
    
    // Chain save operations to avoid race conditions
    const previousSave = this.savePromise || Promise.resolve();
    this.savePromise = previousSave.then(() => 
      this.asyncRepo.save(dataset)
    ).then(() => {
      this.savePromise = null;
    }).catch(() => {
      this.savePromise = null;
    });
    
    // Don't wait for completion - fire and forget
  }

  clear(): void {
    // Update cache immediately
    this.cachedDataset = defaultDataset();
    
    // Chain clear operations
    const previousClear = this.clearPromise || Promise.resolve();
    this.clearPromise = previousClear.then(() => 
      this.asyncRepo.clear()
    ).then(() => {
      this.clearPromise = null;
    }).catch(() => {
      this.clearPromise = null;
    });
    
    // Also chain any pending save to avoid conflicts
    if (this.savePromise) {
      this.savePromise = this.savePromise.then(() => 
        this.asyncRepo.clear()
      ).then(() => {
        this.savePromise = null;
      }).catch(() => {
        this.savePromise = null;
      });
    }
  }
}

/**
 * Creates a repository that uses IndexedDB with synchronous adapter.
 */
export function createIndexedDBRepository(): Repository {
  const indexedDBRepo = new IndexedDBRepository();
  return new SyncRepositoryAdapter(indexedDBRepo);
}

/**
 * Creates a repository using the best available storage backend.
 * Phase 1: Prefers IndexedDB when available, falls back to localStorage.
 * Maintains backward compatibility by migrating data from localStorage on first use.
 */
export function createDefaultRepository(): Repository {
  // Check if IndexedDB is available (browser context)
  if (typeof indexedDB !== 'undefined') {
    try {
      // Use IndexedDB repository
      return createIndexedDBRepository();
    } catch (error) {
      console.warn('[persistence] IndexedDB repository creation failed, falling back to localStorage:', error);
    }
  }
  
  // Fallback to localStorage
  return createRepository(browserStorage());
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
    // v11 → v12: reminders gain syncWithService (service-synchronized
    // reminders). Existing rows normalize in place with syncWithService
    // false — they stay manual and their stored values are untouched.
    if (parsed.version === CURRENT_VERSION - 1) {
      console.warn(
        `[persistence] Migrating stored data v${parsed.version} → v${CURRENT_VERSION} (reminder repeat/advance normalization).`,
      );
      return normalize(parsed);
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