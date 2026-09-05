import { describe, expect, it, vi } from "vitest";
import { defaultDataset } from "../src/domain/defaults";
import type { Dataset } from "../src/domain/types";
import { createRepository, type StorageBackend } from "../src/persistence/repository";
import { Store } from "../src/state/store";

function memoryBackend(): StorageBackend {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function freshStore(): Store {
  return new Store(createRepository(memoryBackend()));
}

describe("Store", () => {
  it("starts with the default dataset on empty storage", () => {
    expect(freshStore().get()).toEqual(defaultDataset());
  });

  it("update() mutates, persists, and notifies subscribers", () => {
    const store = freshStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.update((draft) => {
      draft.vehicles.push({
        id: "v1",
        name: "خودروی من",
        make: "",
        model: "",
        year: null,
        fuelType: null,
        averageAnnualDistance: null,
        currentOdometer: null,
        odometerUpdatedAt: null,
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:00:00.000Z",
      });
    });

    expect(store.get().vehicles[0].name).toBe("خودروی من");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persists updates so a new store on the same backend sees them", () => {
    const backend = memoryBackend();
    const first = new Store(createRepository(backend));
    first.update((draft) => {
      draft.vehicles.push({
        id: "v1",
        name: "خودروی من",
        make: "",
        model: "",
        year: null,
        fuelType: null,
        averageAnnualDistance: null,
        currentOdometer: 104500,
        odometerUpdatedAt: null,
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:00:00.000Z",
      });
    });

    const second = new Store(createRepository(backend));
    expect(second.get().vehicles[0].currentOdometer).toBe(104500);
  });

  it("replace() swaps the dataset and persists", () => {
    const store = freshStore();
    const other: Dataset = { ...defaultDataset(), exportedAt: "2026-09-04T00:00:00.000Z" };
    store.replace(other);
    expect(store.get().exportedAt).toBe("2026-09-04T00:00:00.000Z");
  });

  it("reset() restores the default dataset and clears storage", () => {
    const store = freshStore();
    store.update((draft) => {
      draft.vehicles.push({ id: "v1", name: "x", make: "", model: "", year: null, fuelType: null, averageAnnualDistance: null, currentOdometer: null, odometerUpdatedAt: null, createdAt: "", updatedAt: "" });
    });
    store.reset();
    expect(store.get()).toEqual(defaultDataset());
  });

  it("unsubscribe stops notifications", () => {
    const store = freshStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.update(() => {});
    expect(listener).not.toHaveBeenCalled();
  });
});