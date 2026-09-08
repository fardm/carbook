import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recommendedDueForService,
  resolveReminder,
  resolveReminders,
} from "../src/domain/reminder-sync";
import { calculateMaintenance, contextForVehicle } from "../src/domain/maintenance/calculations";
import { advanceRecurringReminders, clearReminderCheckState, occurrenceKey, runReminderCheck } from "../src/domain/reminder-checker";
import { validateReminderDraft, type ReminderDraft } from "../src/domain/reminders";
import { normalizeReminder } from "../src/persistence/reminder-normalize";
import { buildExport, serializeExport, validateImportText } from "../src/persistence/import-export";
import { defaultDataset } from "../src/domain/defaults";
import type { Dataset, MaintenanceItem, Reminder, ServiceRecord } from "../src/domain/types";

/**
 * Service-synchronized reminders (v12): a reminder with syncWithService
 * true resolves its due date/mileage live from the linked service's
 * next-recommended schedule — the service is the source of truth.
 */

const VEHICLE_ID = "v1";
const ITEM_ID = "item1";

function vehicle() {
  return {
    id: VEHICLE_ID,
    name: "پژو ۲۰۷",
    make: "",
    model: "",
    year: 1398,
    fuelType: "gasoline" as const,
    averageAnnualDistance: 12_000,
    currentOdometer: 100_000,
    odometerUpdatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function item(overrides: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: ITEM_ID,
    vehicleId: VEHICLE_ID,
    catalogId: null,
    name: "روغن موتور",
    category: "engine",
    icon: "droplets",
    rule: { intervalKm: 10_000, intervalMonths: 6, trigger: "any", displayMode: "auto" },
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Last service 2026-03-01 @ 95,000 km → next due 2026-09-01 / 105,000 km. */
function serviceRecord(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: "sr1",
    maintenanceItemId: ITEM_ID,
    vehicleId: VEHICLE_ID,
    date: "2026-03-01",
    odometer: 95_000,
    notes: "",
    cost: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    vehicleId: VEHICLE_ID,
    title: "یادآوری سرویس",
    description: "",
    serviceId: ITEM_ID,
    syncWithService: true,
    type: "date_mileage",
    dueDate: "2026-09-01",
    dueMileage: 105_000,
    notificationOffsets: [],
    repeat: "none",
    repeatWeekday: null,
    repeatEveryKm: null,
    enabled: true,
    lastCompletedDate: null,
    lastCompletedMileage: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function datasetWith(
  parts: { item?: MaintenanceItem | null; service?: ServiceRecord | null; reminder?: Reminder } = {},
): Dataset {
  const dataset = defaultDataset();
  dataset.vehicles.push(vehicle());
  if (parts.item !== null) dataset.maintenanceItems.push(parts.item ?? item());
  if (parts.service !== null) dataset.serviceHistory.push(parts.service ?? serviceRecord());
  if (parts.reminder) dataset.reminders.push(parts.reminder);
  return dataset;
}

describe("recommendedDueForService", () => {
  it("returns the service's next-recommended date and mileage", () => {
    const dataset = datasetWith();
    expect(recommendedDueForService(dataset.maintenanceItems[0], dataset)).toEqual({
      dueDate: "2026-09-01", // 2026-03-01 + 6 months
      dueMileage: 105_000, // 95,000 + 10,000
    });
  });

  it("returns nulls when the service has no baseline yet", () => {
    const dataset = datasetWith({ service: null });
    expect(recommendedDueForService(dataset.maintenanceItems[0], dataset)).toEqual({
      dueDate: null,
      dueMileage: null,
    });
  });

  it("returns null on the side the service has no interval for", () => {
    const dataset = datasetWith({
      item: item({
        rule: { intervalKm: null, intervalMonths: 6, trigger: "any", displayMode: "auto" },
      }),
    });
    expect(recommendedDueForService(dataset.maintenanceItems[0], dataset)).toEqual({
      dueDate: "2026-09-01",
      dueMileage: null,
    });
  });

  it("uses the estimated due date when the service is km-only (same as service detail)", () => {
    const dataset = datasetWith({
      item: item({
        rule: { intervalKm: 10_000, intervalMonths: null, trigger: "any", displayMode: "auto" },
      }),
    });
    const recommended = recommendedDueForService(dataset.maintenanceItems[0], dataset);
    const calc = calculateMaintenance(
      dataset.maintenanceItems[0],
      contextForVehicle(dataset, VEHICLE_ID),
    );
    expect(recommended.dueMileage).toBe(105_000);
    expect(recommended.dueDate).toBe(calc.estimatedDueDate);
    expect(recommended.dueDate).not.toBeNull();
  });

  it("leaves the date null when a km-only service cannot estimate one", () => {
    const dataset = datasetWith({
      item: item({
        rule: { intervalKm: 10_000, intervalMonths: null, trigger: "any", displayMode: "auto" },
      }),
    });
    dataset.vehicles[0].averageAnnualDistance = null;
    expect(recommendedDueForService(dataset.maintenanceItems[0], dataset)).toEqual({
      dueDate: null,
      dueMileage: 105_000,
    });
  });
});

describe("resolveReminder", () => {
  it("resolves a synced reminder's values from the service", () => {
    const dataset = datasetWith({ reminder: reminder({ title: "قدیمی", dueDate: "2000-01-01", dueMileage: 1 }) });
    const resolved = resolveReminder(dataset.reminders[0], dataset);
    expect(resolved.title).toBe("روغن موتور");
    expect(resolved.dueDate).toBe("2026-09-01");
    expect(resolved.dueMileage).toBe(105_000);
  });

  it("restricts values to the conditions the reminder type watches", () => {
    const dataset = datasetWith();
    const dateOnly = resolveReminder(reminder({ type: "date" }), dataset);
    expect(dateOnly.dueDate).toBe("2026-09-01");
    expect(dateOnly.dueMileage).toBeNull();

    const kmOnly = resolveReminder(reminder({ type: "mileage" }), dataset);
    expect(kmOnly.dueDate).toBeNull();
    expect(kmOnly.dueMileage).toBe(105_000);
  });

  it("never touches a manual reminder — even one referencing a service", () => {
    const dataset = datasetWith({ reminder: reminder({ syncWithService: false, title: "دستی", dueDate: "2000-01-01", dueMileage: 1 }) });
    const resolved = resolveReminder(dataset.reminders[0], dataset);
    expect(resolved).toBe(dataset.reminders[0]); // same object — untouched
    expect(resolved.dueDate).toBe("2000-01-01");
  });

  it("falls back to stored values when the linked service no longer exists", () => {
    const dataset = datasetWith({ item: null, reminder: reminder({ dueDate: "2026-09-01" }) });
    const resolved = resolveReminder(dataset.reminders[0], dataset);
    expect(resolved.dueDate).toBe("2026-09-01");
    expect(resolved.dueMileage).toBe(105_000);
  });

  it("falls back when the synced reminder has no serviceId", () => {
    const dataset = datasetWith({ reminder: reminder({ serviceId: null }) });
    const resolved = resolveReminder(dataset.reminders[0], dataset);
    expect(resolved).toBe(dataset.reminders[0]);
  });
});

describe("resolveReminders", () => {
  it("maps every reminder in one pass", () => {
    const dataset = datasetWith({
      reminder: reminder(),
    });
    dataset.reminders.push(reminder({ id: "r2", syncWithService: false, title: "دستی" }));
    const resolved = resolveReminders(dataset.reminders, dataset);
    expect(resolved[0].title).toBe("روغن موتور");
    expect(resolved[1].title).toBe("دستی");
  });
});

describe("occurrenceKey — synced reminders key on their due values", () => {
  it("keys a manual one-time reminder on the id alone", () => {
    expect(occurrenceKey(reminder({ syncWithService: false, repeat: "none" }))).toBe("once");
  });

  it("keys a synced reminder on its resolved due values even with repeat none", () => {
    expect(occurrenceKey(reminder({ repeat: "none" }))).toBe("2026-09-01|105000");
  });
});

describe("runReminderCheck — synced reminders", () => {
  /** Minimal localStorage shim: the checker persists dedupe state there. */
  function installStorageShim(): void {
    const backing = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    };
  }

  beforeEach(() => {
    installStorageShim();
    clearReminderCheckState();
  });
  afterEach(() => {
    clearReminderCheckState();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("fires from the RESOLVED due date with the service's name", () => {
    // Service due 2026-09-01; 7-day offset; today 2026-08-28 → 4 days left.
    const dataset = datasetWith({
      reminder: reminder({
        type: "date",
        dueMileage: null,
        notificationOffsets: [{ days: 7 }],
      }),
    });
    const result = runReminderCheck(dataset, "2026-08-28");
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].body).toContain("روغن موتور");
  });

  it("notifies again when the service's schedule moves (new occurrence)", () => {
    const dataset = datasetWith({
      reminder: reminder({ notificationOffsets: [{ days: 7 }, { km: 10_000 }] }),
    });
    // Occurrence 1: date lead (due 2026-09-01, today 08-28) AND km lead
    // (odometer 100,000 ≥ 105,000 − 10,000) both fire.
    expect(runReminderCheck(dataset, "2026-08-28").fired).toHaveLength(2);
    // The user records the service again → the baseline (and the reminder's
    // resolved due values) move; the km lead of the NEW occurrence fires
    // (odometer 100,000 ≥ 110,000 − 10,000) even though the date lead of
    // the old occurrence can never fire again.
    dataset.serviceHistory.push(serviceRecord({ id: "sr2", date: "2026-08-28", odometer: 100_000, createdAt: "2026-08-28T00:00:00.000Z" }));
    const again = runReminderCheck(dataset, "2026-08-28");
    expect(again.fired).toHaveLength(1);
    expect(dataset.reminders[0].dueDate).toBe("2026-09-01"); // stored values untouched
    expect(resolveReminder(dataset.reminders[0], dataset).dueDate).toBe("2027-02-28"); // 2026-08-28 + 6 months
  });

  it("never notifies twice for the same occurrence", () => {
    const dataset = datasetWith({
      reminder: reminder({ type: "date", dueMileage: null, notificationOffsets: [{ days: 7 }] }),
    });
    expect(runReminderCheck(dataset, "2026-08-28").fired).toHaveLength(1);
    expect(runReminderCheck(dataset, "2026-08-28").fired).toHaveLength(0);
  });

  it("does not fire when the resolved schedule provides no date", () => {
    const dataset = datasetWith({
      service: null, // no baseline → no resolved due date
      reminder: reminder({ type: "date", dueMileage: null, notificationOffsets: [{ days: 7 }] }),
    });
    expect(runReminderCheck(dataset, "2026-08-28").fired).toHaveLength(0);
  });
});

describe("advanceRecurringReminders — synced reminders never roll", () => {
  it("leaves a due synced reminder alone (the service is its recurrence)", () => {
    const dataset = datasetWith({ reminder: reminder({ repeat: "weekly", repeatWeekday: 0, dueDate: "2026-01-03" }) });
    const rolled = advanceRecurringReminders(dataset, "2026-01-03");
    expect(rolled).toEqual([]);
    expect(dataset.reminders[0].dueDate).toBe("2026-01-03"); // unchanged
    expect(dataset.reminders[0].lastCompletedDate).toBeNull();
  });

  it("still rolls a manual weekly reminder", () => {
    const dataset = datasetWith({
      service: null,
      reminder: reminder({ syncWithService: false, repeat: "weekly", repeatWeekday: 0, dueDate: "2026-01-03" }),
    });
    const rolled = advanceRecurringReminders(dataset, "2026-01-03");
    expect(rolled).toEqual(["r1"]);
    expect(dataset.reminders[0].dueDate).toBe("2026-01-10");
  });
});

describe("validateReminderDraft — synced drafts", () => {
  const baseDraft: ReminderDraft = {
    vehicleId: VEHICLE_ID,
    title: "روغن موتور",
    description: "",
    serviceId: ITEM_ID,
    synced: true,
    type: "date_mileage",
    dueDate: null,
    dueMileage: null,
    notificationOffsets: [],
    repeat: "none",
    repeatWeekday: null,
    repeatEveryKm: null,
    enabled: true,
  };

  it("reports syncDateUnavailable (not dueDateRequired) when the service has no date", () => {
    const errors = validateReminderDraft({ ...baseDraft, type: "date" });
    expect(errors).toContain("syncDateUnavailable");
    expect(errors).not.toContain("dueDateRequired");
  });

  it("reports syncKmUnavailable (not dueMileageRequired) when the service has no km", () => {
    const errors = validateReminderDraft({ ...baseDraft, type: "mileage" });
    expect(errors).toContain("syncKmUnavailable");
    expect(errors).not.toContain("dueMileageRequired");
  });

  it("accepts a synced draft once the service provides the watched values", () => {
    expect(validateReminderDraft({ ...baseDraft, type: "date", dueDate: "2026-09-01" })).toEqual([]);
    expect(validateReminderDraft({ ...baseDraft, type: "mileage", dueMileage: 105_000 })).toEqual([]);
  });

  it("still validates values a synced draft somehow carries", () => {
    expect(validateReminderDraft({ ...baseDraft, type: "date", dueDate: "not-a-date" })).toContain("dueDateInvalid");
  });
});

describe("import/export — reminders", () => {
  it("round-trips a synced reminder without data loss", () => {
    const dataset = datasetWith({ reminder: reminder() });
    const text = serializeExport(buildExport(dataset, "2026-09-07T00:00:00.000Z"));
    const result = validateImportText(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const imported = result.dataset.reminders[0];
      expect(imported.syncWithService).toBe(true);
      expect(imported.serviceId).toBe(ITEM_ID);
      expect(imported.type).toBe("date_mileage");
      expect(imported.dueDate).toBe("2026-09-01");
      expect(imported.dueMileage).toBe(105_000);
    }
  });

  it("rejects a reminder missing syncWithService (v12 requires the field)", () => {
    const dataset = datasetWith({ reminder: reminder() });
    const text = serializeExport(buildExport(dataset, "2026-09-07T00:00:00.000Z"));
    const parsed = JSON.parse(text) as { reminders: Array<Record<string, unknown>> };
    delete parsed.reminders[0].syncWithService;
    const result = validateImportText(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes("reminders[0].syncWithService"))).toBe(true);
    }
  });

  it("rejects a non-boolean syncWithService", () => {
    const dataset = datasetWith({ reminder: reminder() });
    const text = serializeExport(buildExport(dataset, "2026-09-07T00:00:00.000Z"));
    const parsed = JSON.parse(text) as { reminders: Array<Record<string, unknown>> };
    parsed.reminders[0].syncWithService = "true";
    const result = validateImportText(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
  });
});

describe("normalizeReminder — v12 syncWithService default", () => {
  it("defaults missing syncWithService to false (pre-v12 rows stay manual)", () => {
    const legacy = normalizeReminder({
      id: "r1",
      vehicleId: VEHICLE_ID,
      title: "قدیمی",
      type: "date",
      dueDate: "2026-01-01",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "none",
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(legacy?.syncWithService).toBe(false);
  });

  it("keeps an explicit true and coerces anything else to false", () => {
    const synced = normalizeReminder({
      id: "r2",
      vehicleId: VEHICLE_ID,
      title: "همگام",
      syncWithService: true,
      type: "date",
      dueDate: "2026-01-01",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "none",
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(synced?.syncWithService).toBe(true);

    const junk = normalizeReminder({
      id: "r3",
      vehicleId: VEHICLE_ID,
      title: "نامعتبر",
      syncWithService: "yes",
      type: "date",
      dueDate: "2026-01-01",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "none",
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(junk?.syncWithService).toBe(false);
  });
});
