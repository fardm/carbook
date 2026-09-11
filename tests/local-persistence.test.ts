// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defaultDataset } from "../src/domain/defaults";
import { createId } from "../src/domain/ids";
import type { Dataset, Vehicle } from "../src/domain/types";
import { createDefaultRepository } from "../src/persistence/repository";
import { Store } from "../src/state/store";

/**
 * Regression tests for the guest (unauthenticated) IndexedDB persistence bug:
 * local data vanished after a page refresh because the store persisted the
 * in-memory (still empty) default dataset before its asynchronous IndexedDB
 * load had settled.
 *
 * A tiny in-memory IndexedDB stand-in whose storage map is SHARED across
 * `open()` calls lets two Store instances simulate two page loads.
 */

let storage: Map<string, unknown>;

function installFakeIndexedDB(): () => void {
  storage = new Map();
  const holder = globalThis as { indexedDB?: unknown; IDBRequest?: unknown };
  const originalIndexedDB = holder.indexedDB;
  const originalRequest = holder.IDBRequest;
  holder.IDBRequest = class FakeIDBRequest {};
  holder.indexedDB = {
    open: () => {
      const db = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            get: (key: string) => requestFor(storage.get(key) ?? null),
            put: (value: unknown, key: string) => {
              storage.set(key, value);
              return requestFor(undefined);
            },
            delete: (key: string) => {
              storage.delete(key);
              return requestFor(undefined);
            },
          }),
        }),
        close: () => undefined,
      };
      const request = newRequest();
      request.onupgradeneeded = null;
      request.onerror = null;
      request.onsuccess = null;
      request.result = db;
      setTimeout(() => fireSuccess(request), 0);
      return request;
    },
  };
  return () => {
    holder.indexedDB = originalIndexedDB;
    holder.IDBRequest = originalRequest;
  };
}

function newRequest(): Record<string, unknown> {
  const Ctor = (globalThis as { IDBRequest?: new () => object }).IDBRequest as new () => object;
  return new Ctor() as Record<string, unknown>;
}

function requestFor(result: unknown): IDBRequest {
  const request = newRequest();
  request.onerror = null;
  request.onsuccess = null;
  request.result = result;
  setTimeout(() => fireSuccess(request), 0);
  return request as unknown as IDBRequest;
}

function fireSuccess(request: Record<string, unknown>): void {
  (request.onsuccess as ((event: unknown) => void) | null)?.call(request, { target: request });
}

function vehicle(name: string): Vehicle {
  return {
    id: createId(),
    name,
    make: "",
    model: "",
    year: null,
    fuelType: null,
    averageAnnualDistance: null,
    currentOdometer: 104500,
    odometerUpdatedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

/** Waits long enough for the fire-and-forget IndexedDB write chain to land. */
function flushIndexedDB(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

describe("guest IndexedDB persistence", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = installFakeIndexedDB();
  });

  afterEach(() => restore());

  it("keeps local data across a simulated page refresh", async () => {
    // Page load #1: guest writes a vehicle.
    const first = new Store(createDefaultRepository());
    await first.ready();
    first.update((draft) => {
      draft.vehicles.push(vehicle("خودروی من"));
    });
    await flushIndexedDB();

    // Page load #2 (refresh): a brand-new store reads the same IndexedDB.
    const second = new Store(createDefaultRepository());
    await second.ready();
    expect(second.get().vehicles).toHaveLength(1);
    expect(second.get().vehicles[0]?.name).toBe("خودروی من");
  });

  it("ready() resolves only after the stored dataset has been adopted", async () => {
    const seeded = new Store(createDefaultRepository());
    await seeded.ready();
    seeded.update((draft) => {
      draft.vehicles.push(vehicle("خودروی ذخیره‌شده"));
    });
    await flushIndexedDB();

    const next = new Store(createDefaultRepository());
    // Before awaiting readiness the snapshot is still the provisional default.
    expect(next.get()).toEqual(defaultDataset());
    await next.ready();
    expect(next.get().vehicles[0]?.name).toBe("خودروی ذخیره‌شده");
  });

  it("never overwrites stored data when a write happens before hydration", async () => {
    // Seed persisted guest data.
    const seeded = new Store(createDefaultRepository());
    await seeded.ready();
    seeded.update((draft) => {
      draft.vehicles.push(vehicle("داده‌ی مهم"));
    });
    await flushIndexedDB();

    // Refresh: a boot-time write (e.g. the reminder checker) fires BEFORE the
    // asynchronous IndexedDB load has settled. It must be replayed on top of
    // the loaded dataset, not persisted as the empty default.
    const booting = new Store(createDefaultRepository());
    booting.update((draft) => {
      draft.settings.theme = "dark";
    });
    await booting.ready();
    await flushIndexedDB();

    // The running session kept the data…
    expect(booting.get().vehicles[0]?.name).toBe("داده‌ی مهم");
    expect(booting.get().settings.theme).toBe("dark");

    // …and the NEXT refresh still sees it (nothing was wiped from IndexedDB).
    const after = new Store(createDefaultRepository());
    await after.ready();
    expect(after.get().vehicles[0]?.name).toBe("داده‌ی مهم");
    expect(after.get().settings.theme).toBe("dark");
  });

  it("notifies subscribers once the stored dataset is adopted", async () => {
    const seeded = new Store(createDefaultRepository());
    await seeded.ready();
    seeded.update((draft) => {
      draft.vehicles.push(vehicle("ماشین"));
    });
    await flushIndexedDB();

    const next = new Store(createDefaultRepository());
    const listener = vi.fn();
    next.subscribe(listener);
    await next.ready();
    expect(listener).toHaveBeenCalled();
  });

  it("replays multiple pre-hydration writes in order", async () => {
    const seeded = new Store(createDefaultRepository());
    await seeded.ready();
    seeded.update((draft) => {
      draft.vehicles.push(vehicle("ماشین"));
    });
    await flushIndexedDB();

    const booting = new Store(createDefaultRepository());
    booting.update((draft) => {
      draft.settings.currency = "USD";
    });
    booting.update((draft) => {
      draft.settings.theme = "dark";
    });
    await booting.ready();
    await flushIndexedDB();

    const after = new Store(createDefaultRepository());
    await after.ready();
    const stored: Dataset = after.get();
    expect(stored.vehicles).toHaveLength(1);
    expect(stored.settings.currency).toBe("USD");
    expect(stored.settings.theme).toBe("dark");
  });
});
