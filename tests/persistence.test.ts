import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, defaultDataset } from "../src/domain/defaults";
import { createId } from "../src/domain/ids";
import type { Dataset } from "../src/domain/types";
import { STORAGE_KEY, createRepository, loadFromString, type StorageBackend } from "../src/persistence/repository";

/** In-memory StorageBackend for tests. */
function memoryBackend(): StorageBackend & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

function populatedDataset(): Dataset {
  const dataset = defaultDataset();
  dataset.vehicles = [
    {
      id: createId(),
      name: "پژو ۲۰۷",
      make: "پژو",
      model: "207",
      year: 1390,
      fuelType: "gasoline",
      averageDailyDistance: 40,
      currentOdometer: 103900,
      odometerUpdatedAt: "2026-09-04T10:00:00.000Z",
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
    },
  ];
  dataset.maintenanceItems = [
    {
      id: createId(),
      vehicleId: dataset.vehicles[0].id,
      catalogId: "engineOil",
      name: "روغن موتور",
      category: "engine",
      icon: "droplets",
      rule: { intervalKm: 10000, intervalMonths: 6, trigger: "any", displayMode: "auto", inspectionBased: false },
      active: true,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
    },
  ];
  dataset.serviceHistory = [
    {
      id: createId(),
      maintenanceItemId: dataset.maintenanceItems[0].id,
      vehicleId: dataset.vehicles[0].id,
      date: "2026-08-20",
      odometer: 100000,
      notes: "",
      cost: null,
      createdAt: "2026-08-20T08:00:00.000Z",
    },
  ];
  return dataset;
}

describe("repository", () => {
  it("loads the default dataset from empty storage", () => {
    const repo = createRepository(memoryBackend());
    expect(repo.load()).toEqual(defaultDataset());
  });

  it("round-trips a populated dataset through save/load", () => {
    const backend = memoryBackend();
    const repo = createRepository(backend);
    const dataset = populatedDataset();
    repo.save(dataset);
    expect(repo.load()).toEqual(dataset);
  });

  it("stamps the current version on save", () => {
    const backend = memoryBackend();
    const repo = createRepository(backend);
    const dataset = populatedDataset();
    dataset.version = 999;
    repo.save(dataset);
    const raw = backend.dump()[STORAGE_KEY];
    expect(JSON.parse(raw).version).toBe(CURRENT_VERSION);
    expect(repo.load().version).toBe(CURRENT_VERSION);
  });

  it("clear() empties storage and load() falls back to default", () => {
    const backend = memoryBackend();
    const repo = createRepository(backend);
    repo.save(populatedDataset());
    repo.clear();
    expect(backend.dump()).toEqual({});
    expect(repo.load()).toEqual(defaultDataset());
  });

  it("uses a single storage key", () => {
    const backend = memoryBackend();
    createRepository(backend).save(populatedDataset());
    expect(Object.keys(backend.dump())).toEqual([STORAGE_KEY]);
  });
});

describe("loadFromString — defensive loading", () => {
  it("falls back to default for invalid JSON", () => {
    expect(loadFromString("{oops")).toEqual(defaultDataset());
  });

  it("falls back to default for non-object roots", () => {
    expect(loadFromString('"hello"')).toEqual(defaultDataset());
    expect(loadFromString("[1,2,3]")).toEqual(defaultDataset());
    expect(loadFromString("42")).toEqual(defaultDataset());
  });

  it("falls back to default when version is missing or not a number", () => {
    expect(loadFromString('{"vehicles":[]}')).toEqual(defaultDataset());
    expect(loadFromString('{"version":"1"}')).toEqual(defaultDataset());
  });

  it("falls back to default for a future (unsupported) version", () => {
    expect(loadFromString(JSON.stringify({ version: 99, vehicles: [{ id: "x" }] }))).toEqual(defaultDataset());
  });

  it("migrates legacy version-0 data to the current version", () => {
    const migrated = loadFromString(
      JSON.stringify({ version: 0, vehicle: { id: "v1", name: "پژو" }, settings: { statusThresholds: { dueSoonPercent: 30 } } }),
    );
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect(migrated.vehicles[0].id).toBe("v1");
    expect(migrated.vehicles[0].name).toBe("پژو");
    expect(migrated.vehicles[0].odometerUpdatedAt).toBeNull();
    // Missing arrays are repaired; settings merge with defaults + theme + calendar.
    expect(migrated.maintenanceItems).toEqual([]);
    expect(migrated.serviceHistory).toEqual([]);
    expect(migrated.inspectionHistory).toEqual([]);
    expect(migrated.settings.statusThresholds).toEqual({ dueSoonPercent: 30, duePercent: 5 });
    expect(migrated.settings.theme).toBe("system");
    expect(migrated.settings.calendar).toBe("jalali");
    expect(migrated.settings.currency).toBe("IRR");
  });

  it("migrates v1 settings by adding the theme default (Phase 12)", () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: null,
      vehicle: null,
      odometerHistory: [],
      maintenanceItems: [],
      serviceHistory: [],
      inspectionHistory: [],
      settings: { statusThresholds: { dueSoonPercent: 20, duePercent: 5 } },
    });
    const migrated = loadFromString(raw);
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect(migrated.settings.theme).toBe("system");
    expect(migrated.settings.calendar).toBe("jalali");
    expect(migrated.settings.currency).toBe("IRR");
    expect(migrated.settings.statusThresholds).toEqual({ dueSoonPercent: 20, duePercent: 5 });
  });

  it("migrates v2 settings by adding the calendar default (calendar phase)", () => {
    const raw = JSON.stringify({
      version: 2,
      exportedAt: null,
      vehicle: null,
      odometerHistory: [],
      maintenanceItems: [],
      serviceHistory: [],
      inspectionHistory: [],
      settings: { statusThresholds: { dueSoonPercent: 20, duePercent: 5 }, theme: "dark" },
    });
    const migrated = loadFromString(raw);
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect(migrated.settings.theme).toBe("dark");
    expect(migrated.settings.calendar).toBe("jalali"); // Solar Hijri default
    expect(migrated.settings.currency).toBe("IRR");
  });

  it("migrates v3 single-vehicle data: vehicle + odometerHistory → vehicles[] with current odometer", () => {
    const raw = JSON.stringify({
      version: 3,
      exportedAt: null,
      vehicle: {
        id: "v1",
        name: "پژو ۲۰۷",
        make: "پژو",
        model: "207",
        year: 2019,
        fuelType: "gasoline",
        averageDailyDistance: 40,
        createdAt: "2026-09-04T10:00:00.000Z",
        updatedAt: "2026-09-04T10:00:00.000Z",
      },
      odometerHistory: [
        { id: "o1", date: "2026-08-20", odometer: 103900, createdAt: "2026-08-20T08:00:00.000Z" },
        { id: "o2", date: "2026-09-01", odometer: 104500, createdAt: "2026-09-01T08:00:00.000Z" },
        { id: "o3", date: "2026-08-20", odometer: 103200, createdAt: "2026-08-20T07:00:00.000Z" },
      ],
      maintenanceItems: [{ id: "m1", catalogId: "engineOil", name: "روغن موتور", category: "engine", icon: "droplets", active: true }],
      serviceHistory: [{ id: "s1", maintenanceItemId: "m1", date: "2026-06-01", odometer: 94500, notes: "", cost: null, createdAt: "2026-06-01T08:00:00.000Z" }],
      inspectionHistory: [{ id: "i1", maintenanceItemId: "m1", date: "2026-09-01", odometer: 104500, condition: "good", measurement: null, notes: "", createdAt: "2026-09-01T11:00:00.000Z" }],
      settings: { statusThresholds: { dueSoonPercent: 20, duePercent: 5 }, theme: "system", calendar: "jalali" },
    });
    const migrated = loadFromString(raw);
    expect(migrated.version).toBe(CURRENT_VERSION);
    // Single vehicle preserved, current odometer = latest reading by (date, createdAt).
    expect(migrated.vehicles).toHaveLength(1);
    expect(migrated.vehicles[0].id).toBe("v1");
    expect(migrated.vehicles[0].name).toBe("پژو ۲۰۷");
    expect(migrated.vehicles[0].currentOdometer).toBe(104500);
    // The mileage timestamp is added (null) by the v5→v6 migration.
    expect(migrated.vehicles[0].odometerUpdatedAt).toBeNull();
    // Every item/record is linked to the vehicle (nothing shared, nothing dropped).
    expect(migrated.maintenanceItems[0].vehicleId).toBe("v1");
    expect(migrated.serviceHistory[0].vehicleId).toBe("v1");
    expect(migrated.inspectionHistory[0].vehicleId).toBe("v1");
    expect(migrated.inspectionHistory[0].condition).toBe("good");
    // Legacy collections are gone.
    expect((migrated as unknown as Record<string, unknown>).odometerHistory).toBeUndefined();
    expect((migrated as unknown as Record<string, unknown>).vehicle).toBeUndefined();
    // The currency default is added by the v6→v7 migration.
    expect(migrated.settings.currency).toBe("IRR");
  });

  it("migrates v6 settings by adding the currency default (تومان)", () => {
    const raw = JSON.stringify({
      version: 6,
      exportedAt: null,
      vehicles: [{ id: "v1", name: "پژو ۲۰۷", odometerUpdatedAt: null }],
      maintenanceItems: [],
      serviceHistory: [],
      inspectionHistory: [],
      settings: { statusThresholds: { dueSoonPercent: 20, duePercent: 5 }, theme: "light", calendar: "gregorian" },
    });
    const migrated = loadFromString(raw);
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect(migrated.settings.calendar).toBe("gregorian");
    expect(migrated.settings.theme).toBe("light");
    expect(migrated.settings.currency).toBe("IRR");
    // An existing currency value is preserved.
    const withCurrency = loadFromString(
      JSON.stringify({
        ...JSON.parse(raw),
        settings: { ...JSON.parse(raw).settings, currency: "EUR" },
      }),
    );
    expect(withCurrency.settings.currency).toBe("EUR");
  });

  it("repairs partially-shaped current-version data", () => {
    const migrated = loadFromString(JSON.stringify({ version: 1 }));
    expect(migrated).toEqual(defaultDataset());
  });
});