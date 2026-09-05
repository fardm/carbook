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
      averageAnnualDistance: 14600,
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
      rule: { intervalKm: 10000, intervalMonths: 6, trigger: "any", displayMode: "auto" },
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

  it("falls back to default for an unsupported version (older or newer)", () => {
    // v8 is the baseline: pre-v8 (e.g. v7 inspection-era) data has no
    // migration path, and future versions are unknown — both are ignored.
    expect(loadFromString(JSON.stringify({ version: 7, vehicles: [{ id: "x" }] }))).toEqual(defaultDataset());
    expect(loadFromString(JSON.stringify({ version: 99, vehicles: [{ id: "x" }] }))).toEqual(defaultDataset());
  });

  it("repairs partially-shaped current-version data", () => {
    const migrated = loadFromString(
      JSON.stringify({ version: CURRENT_VERSION, settings: { statusThresholds: { dueSoonPercent: 30 } } }),
    );
    expect(migrated.version).toBe(CURRENT_VERSION);
    // Missing arrays are repaired; settings merge with defaults.
    expect(migrated.vehicles).toEqual([]);
    expect(migrated.maintenanceItems).toEqual([]);
    expect(migrated.serviceHistory).toEqual([]);
    expect(migrated.settings.statusThresholds).toEqual({ dueSoonPercent: 30, duePercent: 5 });
    expect(migrated.settings.theme).toBe("system");
    expect(migrated.settings.calendar).toBe("jalali");
    expect(migrated.settings.currency).toBe("IRR");
  });
});