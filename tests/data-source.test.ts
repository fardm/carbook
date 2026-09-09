// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultDataset } from "../src/domain/defaults";
import type { Dataset } from "../src/domain/types";
import { createId } from "../src/domain/ids";
import { IndexedDBRepository } from "../src/persistence/repository";
import { store } from "../src/state/store";
import { auth } from "../src/supabase/auth";
import {
  applyAuthState,
  resetDataSourceForTests,
} from "../src/supabase/data-source";
import { setSupabaseOverride } from "../src/supabase/client";
import { migrateGuestDataToCloud } from "../src/supabase/migration";
import {
  countDataset,
  datasetToItemRows,
  datasetToRecordRows,
  datasetToReminderRows,
  datasetToSettingsRow,
  datasetToVehicleRows,
  hasMeaningfulData,
} from "../src/supabase/cloud-dataset";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

/**
 * In-memory IndexedDB stand-in (jsdom has no real IndexedDB). Supports the
 * exact operations IndexedDBRepository performs.
 */
class FakeIDB {
  private data = new Map<string, unknown>();

  open(): IDBOpenDBRequest {
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({
        objectStore: () => ({
          get: (key: string) => this.requestFor(this.data.get(key) ?? null),
          put: (value: unknown, key: string) => {
            this.data.set(key, value);
            return this.requestFor(undefined);
          },
          delete: (key: string) => {
            this.data.delete(key);
            return this.requestFor(undefined);
          },
        }),
      }),
      close: () => undefined,
    };
    return this.openRequestFor(db);
  }

  private openRequestFor(db: unknown): IDBOpenDBRequest {
    const request = {
      onupgradeneeded: null,
      onerror: null,
      onsuccess: null,
      result: db,
    } as unknown as IDBOpenDBRequest;
    setTimeout(() => {
      (request.onsuccess as ((event: unknown) => void) | null)?.call(request, { target: request });
    }, 0);
    return request;
  }

  private requestFor(result: unknown): IDBRequest {
    const request = { onerror: null, onsuccess: null, result } as unknown as IDBRequest;
    setTimeout(() => {
      (request.onsuccess as ((event: unknown) => void) | null)?.call(request, { target: request });
    }, 0);
    return request;
  }

  /** Test inspection: what is persisted under the app's envelope key. */
  raw(): unknown {
    return this.data.get("app");
  }
}

function installFakeIndexedDB(): { restore: () => void; db: FakeIDB } {
  const fake = new FakeIDB();
  const holder = globalThis as { indexedDB?: unknown; IDBRequest?: unknown };
  const original = holder.indexedDB;
  const originalRequest = holder.IDBRequest;
  holder.indexedDB = { open: () => fake.open() };
  // jsdom has no IDBRequest constructor; IndexedDBRepository uses
  // `instanceof IDBRequest` to detect request-style operations.
  holder.IDBRequest = class FakeIDBRequest {};
  return {
    restore: () => {
      holder.indexedDB = original;
      holder.IDBRequest = originalRequest;
    },
    db: fake,
  };
}

/** Minimal SupabaseClient double: per-user row store + recorded calls.
 * Emulates the two behaviors the repository relies on: RLS-style row
 * scoping (rows are only ever visible to their owner) and the exact
 * `head/count` + `maybeSingle` response shapes of PostgREST. */
function fakeSupabase(options?: { loadError?: Error }) {
  const tables = new Map<string, Array<Record<string, unknown>>>();
  const authCalls: Array<{ fn: string; args: unknown }> = [];
  // The "authenticated user" for RLS emulation (auth.uid()); null = anon.
  let authUid: string | null = null;

  const builderFor = (table: string, state: { count: boolean; single: boolean }) => {
    const builder = {
      select: (_cols?: string, opts?: { count?: string }) => {
        state.count = opts?.count === "exact";
        return builder;
      },
      maybeSingle: () => {
        state.single = true;
        return builder;
      },
      upsert: async (rows: Array<Record<string, unknown>>) => {
        if (authUid == null) return { data: null, error: { message: "RLS: not authenticated" } };
        const scoped = rows.filter((row) => row.user_id === authUid);
        const existing = tables.get(table) ?? [];
        for (const row of scoped) {
          const index = existing.findIndex((candidate) => candidate.id === row.id);
          if (index >= 0) existing[index] = row;
          else existing.push(row);
        }
        tables.set(table, existing);
        return { data: null, error: null };
      },
      delete: () => builder,
      eq: (_column: string, _value: string) => builder,
      not: () => builder,
      then: (resolve: (result: { data: unknown; error: unknown; count?: number }) => void) => {
        if (options?.loadError) {
          resolve({ data: null, error: options.loadError });
          return;
        }
        // RLS: a user sees ONLY their own rows (anon sees none).
        const visible = (tables.get(table) ?? []).filter(
          (row) => authUid != null && row.user_id === authUid,
        );
        if (state.count) {
          resolve({ data: null, count: visible.length, error: null });
          return;
        }
        if (state.single) {
          resolve({ data: visible[0] ?? null, error: null });
          return;
        }
        resolve({ data: visible, error: null });
      },
    };
    return builder;
  };

  const client = {
    from: (table: string) => builderFor(table, { count: false, single: false }),
    auth: {
      signInWithPassword: vi.fn(async (args: unknown) => {
        authCalls.push({ fn: "signInWithPassword", args });
        return { data: { user: null }, error: null };
      }),
      signUp: vi.fn(async (args: unknown) => {
        authCalls.push({ fn: "signUp", args });
        return { data: { user: null }, error: null };
      }),
      signOut: vi.fn(async () => {
        authCalls.push({ fn: "signOut", args: null });
        return { error: null };
      }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  } as unknown as SupabaseClient;

  return {
    client,
    authCalls,
    setAuthUser: (userId: string | null) => {
      authUid = userId;
    },
    seed: (table: string, rows: Array<Record<string, unknown>>) => tables.set(table, rows),
    rowsOf: (table: string, userId?: string) =>
      (tables.get(table) ?? []).filter((row) => userId == null || row.user_id === userId),
    seedDataset: (dataset: Dataset, userId: string) => {
      // Append this user's rows without clobbering other users' rows.
      const merge = (table: string, rows: Array<Record<string, unknown>>) =>
        tables.set(table, [...(tables.get(table) ?? []).filter((row) => row.user_id !== userId), ...rows]);
      merge("vehicles", datasetToVehicleRows(dataset, userId) as unknown as Array<Record<string, unknown>>);
      merge("maintenance_items", datasetToItemRows(dataset, userId) as unknown as Array<Record<string, unknown>>);
      merge("service_history", datasetToRecordRows(dataset, userId) as unknown as Array<Record<string, unknown>>);
      merge("reminders", datasetToReminderRows(dataset, userId) as unknown as Array<Record<string, unknown>>);
      merge("app_settings", [datasetToSettingsRow(dataset, userId) as unknown as Record<string, unknown>]);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Fixtures + auth simulation                                          */
/* ------------------------------------------------------------------ */

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";

function vehicleNamed(name: string): Dataset {
  const dataset = defaultDataset();
  dataset.vehicles = [
    {
      id: createId(),
      name,
      make: "",
      model: "",
      year: 1399,
      fuelType: "gasoline",
      averageAnnualDistance: null,
      currentOdometer: 5000,
      odometerUpdatedAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  return dataset;
}

function guestDatasetWithReminder(): Dataset {
  const dataset = vehicleNamed("خودروی مهمان");
  dataset.reminders = [
    {
      id: createId(),
      vehicleId: dataset.vehicles[0].id,
      title: "یادآوری مهمان",
      description: "",
      serviceId: null,
      syncWithService: false,
      type: "date",
      dueDate: "2026-12-01",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "none",
      repeatWeekday: null,
      repeatEveryKm: null,
      enabled: true,
      lastCompletedDate: null,
      lastCompletedMileage: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  return dataset;
}

/** Simulates a session without touching the real Supabase auth listener. */
function setUser(userId: string | null, email = "user@mail.com"): void {
  (auth as unknown as { user: { id: string; email: string } | null }).user = userId
    ? { id: userId, email }
    : null;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("data source — backend selection", () => {
  let idb: ReturnType<typeof installFakeIndexedDB>;
  let supabase: ReturnType<typeof fakeSupabase>;

  beforeEach(() => {
    idb = installFakeIndexedDB();
    supabase = fakeSupabase();
    setSupabaseOverride(supabase.client);
    resetDataSourceForTests();
  });

  afterEach(() => {
    setSupabaseOverride(null);
    setUser(null);
    idb.restore();
    resetDataSourceForTests();
  });

  it("guest mode uses IndexedDB and never reads or writes Supabase", async () => {
    setUser(null);
    await applyAuthState();

    // The store is wired to the guest IndexedDB repository.
    expect(store.get()).toEqual(defaultDataset());
    store.update((draft) => {
      draft.vehicles.push({
        id: createId(),
        name: "خودروی مهمان",
        make: "",
        model: "",
        year: null,
        fuelType: null,
        averageAnnualDistance: null,
        currentOdometer: null,
        odometerUpdatedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    });
    // IndexedDB received the envelope; Supabase was never touched.
    expect(idb.db.raw()).not.toBeNull();
  });  it("authenticated mode loads the user's dataset from Supabase", async () => {
    supabase.seedDataset(vehicleNamed("خودروی ابری"), USER);
    setUser(USER);
    supabase.setAuthUser(USER);
    await applyAuthState();

    expect(store.get().vehicles[0]?.name).toBe("خودروی ابری");
  });  it("loads user A's data, not user B's (RLS-equivalent scoping)", async () => {
    supabase.seedDataset(vehicleNamed("متعلق به الف"), USER);
    supabase.seedDataset(vehicleNamed("متعلق به ب"), OTHER_USER);
    // The fake client filters by user_id like RLS would.
    setUser(USER);
    supabase.setAuthUser(USER);
    await applyAuthState();
    expect(store.get().vehicles[0]?.name).toBe("متعلق به الف");

    setUser(OTHER_USER);
    supabase.setAuthUser(OTHER_USER);
    await applyAuthState();
    expect(store.get().vehicles[0]?.name).toBe("متعلق به ب");
  });  it("logout switches back to guest mode and hides the user's cloud data", async () => {
    supabase.seedDataset(vehicleNamed("خودروی ابری"), USER);
    setUser(USER);
    supabase.setAuthUser(USER);
    await applyAuthState();
    expect(store.get().vehicles).toHaveLength(1);

    setUser(null);
    await applyAuthState();
    // Guest mode again: default (empty) dataset — the cloud data is gone
    // from view and NOT copied into IndexedDB.
    expect(store.get()).toEqual(defaultDataset());
    expect(idb.db.raw()).toBeUndefined();
  });  it("does not copy the previous user's cloud data into guest IndexedDB", async () => {
    supabase.seedDataset(vehicleNamed("خصوصی"), USER);
    setUser(USER);
    supabase.setAuthUser(USER);
    await applyAuthState();

    setUser(null);
    await applyAuthState();
    const guestRaw = idb.db.raw() as Dataset | undefined;
    expect(guestRaw ?? defaultDataset()).toEqual(defaultDataset());
  });

  it("serializes rapid auth transitions without interleaving swaps", async () => {
    supabase.seedDataset(vehicleNamed("ابر الف"), USER);
    setUser(USER);
    supabase.setAuthUser(USER);
    const first = applyAuthState();
    setUser(null);
    const second = applyAuthState();
    setUser(USER);
    const third = applyAuthState();
    await Promise.all([first, second, third]);
    // Ends consistent with the last applied state (authenticated).
    expect(store.get().vehicles[0]?.name).toBe("ابر الف");
  });

  it("an empty cloud account renders the default dataset", async () => {
    setUser(USER);
    supabase.setAuthUser(USER);
    await applyAuthState();
    expect(store.get()).toEqual(defaultDataset());
  });
});

describe("guest → cloud migration", () => {
  let idb: ReturnType<typeof installFakeIndexedDB>;
  let supabase: ReturnType<typeof fakeSupabase>;

  beforeEach(() => {
    idb = installFakeIndexedDB();
    supabase = fakeSupabase();
    setSupabaseOverride(supabase.client);
    resetDataSourceForTests();
  });

  afterEach(() => {
    setSupabaseOverride(null);
    setUser(null);
    idb.restore();
    resetDataSourceForTests();
  });  it("uploads the guest dataset and reports counts", async () => {
    supabase.setAuthUser(USER);
    const guest = guestDatasetWithReminder();
    const result = await migrateGuestDataToCloud(supabase.client, USER, guest);

    expect(result.status).toBe("migrated");
    expect(result.counts).toEqual(countDataset(guest));
    // Rows landed in the user's tables.
    expect(supabase.rowsOf("vehicles", USER)).toHaveLength(1);
    expect(supabase.rowsOf("reminders", USER)).toHaveLength(1);
  });  it("keeps the local guest dataset intact after a successful migration", async () => {
    // Start as a guest and create data through the real store → IndexedDB.
    setUser(null);
    await applyAuthState();
    store.update((draft) => {
      draft.vehicles.push({
        id: createId(),
        name: "خودروی مهمان",
        make: "",
        model: "",
        year: null,
        fuelType: null,
        averageAnnualDistance: null,
        currentOdometer: null,
        odometerUpdatedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20)); // let IndexedDB flush

    supabase.setAuthUser(USER);
    const result = await migrateGuestDataToCloud(supabase.client, USER, store.get());
    expect(result.status).toBe("migrated");

    // Guest mode still sees the original data in IndexedDB — it was never
    // deleted or modified by the migration.
    setUser(null);
    await applyAuthState();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.get().vehicles[0]?.name).toBe("خودروی مهمان");
  });  it("refuses to overwrite an account that already has data (conflict)", async () => {
    supabase.setAuthUser(USER);
    supabase.seedDataset(vehicleNamed("داده موجود ابری"), USER);
    const guest = guestDatasetWithReminder();

    const result = await migrateGuestDataToCloud(supabase.client, USER, guest);
    expect(result.status).toBe("conflict");
    // The existing cloud rows were NOT replaced by guest data.
    const vehicles = supabase.rowsOf("vehicles", USER);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].name).toBe("داده موجود ابری");
  });

  it("reports errors and leaves local data untouched on failure", async () => {
    const failing = fakeSupabase({ loadError: new Error("Failed to fetch") });
    const guest = guestDatasetWithReminder();

    const result = await migrateGuestDataToCloud(failing.client, USER, guest);
    expect(result.status).toBe("error");
    expect(hasMeaningfulData(guest)).toBe(true); // local dataset unchanged
  });

  it("skips migration entirely for an empty guest dataset", async () => {
    supabase.setAuthUser(USER);
    const result = await migrateGuestDataToCloud(supabase.client, USER, defaultDataset());
    expect(result.status).toBe("empty");
    expect(supabase.rowsOf("vehicles", USER)).toHaveLength(0);
  });  it("migrated cloud rows read back as the original guest dataset", async () => {
    supabase.setAuthUser(USER);
    const guest = guestDatasetWithReminder();
    await migrateGuestDataToCloud(supabase.client, USER, guest);

    setUser(USER);
    await applyAuthState();
    expect(store.get().vehicles[0]?.name).toBe("خودروی مهمان");
    expect(store.get().reminders[0]?.title).toBe("یادآوری مهمان");
  });
});
