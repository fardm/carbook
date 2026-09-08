import { describe, expect, it } from "vitest";
import { nextOccurrence, validateReminderDraft, type ReminderDraft } from "../src/domain/reminders";
import { advanceRecurringReminders } from "../src/domain/reminder-checker";
import { normalizeReminder } from "../src/persistence/reminder-normalize";
import { defaultDataset } from "../src/domain/defaults";
import type { Reminder } from "../src/domain/types";

/**
 * Weekly repeat + single-advance-per-kind tests (v11).
 * Weekday convention: 0 = Saturday … 6 = Friday (domain/calendar weekdayOf).
 */

const baseDraft: ReminderDraft = {
  vehicleId: "v1",
  title: "بیمه",
  description: "",
  serviceId: null,
  synced: false,
  type: "date",
  dueDate: "2026-09-10",
  dueMileage: null,
  notificationOffsets: [],
  repeat: "none",
  repeatWeekday: null,
  repeatEveryKm: null,
  enabled: true,
};

describe("validateReminderDraft — weekly", () => {
  it("accepts weekly with a 0–6 weekday", () => {
    expect(validateReminderDraft({ ...baseDraft, repeat: "weekly", repeatWeekday: 0 })).toEqual([]);
    expect(validateReminderDraft({ ...baseDraft, repeat: "weekly", repeatWeekday: 6 })).toEqual([]);
  });

  it("requires a weekday for weekly repeat", () => {
    expect(validateReminderDraft({ ...baseDraft, repeat: "weekly", repeatWeekday: null })).toContain(
      "repeatWeekdayInvalid",
    );
    expect(validateReminderDraft({ ...baseDraft, repeat: "weekly", repeatWeekday: 7 })).toContain(
      "repeatWeekdayInvalid",
    );
    expect(validateReminderDraft({ ...baseDraft, repeat: "weekly", repeatWeekday: -1 })).toContain(
      "repeatWeekdayInvalid",
    );
  });
});

describe("validateReminderDraft — optional due date", () => {
  it("accepts a general reminder with no due date", () => {
    expect(validateReminderDraft({ ...baseDraft, serviceId: null, dueDate: null })).toEqual([]);
    expect(validateReminderDraft({ ...baseDraft, serviceId: null, dueDate: "" })).toEqual([]);
  });

  it("still requires a due date for service-linked reminders", () => {
    expect(validateReminderDraft({ ...baseDraft, serviceId: "svc1", dueDate: null })).toContain(
      "dueDateRequired",
    );
  });

  it("still rejects an invalid due date when one is provided", () => {
    expect(validateReminderDraft({ ...baseDraft, serviceId: null, dueDate: "not-a-date" })).toContain(
      "dueDateInvalid",
    );
  });
});

function weeklyReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: "r1",
    vehicleId: "v1",
    title: "یادآوری هفتگی",
    description: "",
    serviceId: null,
    syncWithService: false,
    type: "date",
    dueDate: "2026-01-03", // Saturday
    dueMileage: null,
    notificationOffsets: [],
    repeat: "weekly",
    repeatWeekday: 0,
    repeatEveryKm: null,
    enabled: true,
    lastCompletedDate: null,
    lastCompletedMileage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("nextOccurrence — weekly", () => {
  it("rolls to the next occurrence of the chosen weekday", () => {
    // Completed Monday 2026-01-05 → next Saturday is 2026-01-10.
    const next = nextOccurrence(weeklyReminder({}), "2026-01-05", null);
    expect(next).toEqual({ dueDate: "2026-01-10", dueMileage: null });
  });

  it("rolls a full week when completing on the weekday itself", () => {
    const next = nextOccurrence(weeklyReminder({}), "2026-01-03", null);
    expect(next).toEqual({ dueDate: "2026-01-10", dueMileage: null });
  });

  it("keeps the due mileage for date_mileage reminders", () => {
    const reminder = weeklyReminder({ type: "date_mileage", dueMileage: 120_000 });
    const next = nextOccurrence(reminder, "2026-01-05", 110_000);
    expect(next).toEqual({ dueDate: "2026-01-10", dueMileage: 120_000 });
  });

  it("returns null for mileage-only reminders and missing weekdays", () => {
    expect(nextOccurrence(weeklyReminder({ type: "mileage" }), "2026-01-05", 10_000)).toBeNull();
    expect(nextOccurrence(weeklyReminder({ repeatWeekday: null }), "2026-01-05", null)).toBeNull();
    expect(nextOccurrence(weeklyReminder({ repeatWeekday: 9 }), "2026-01-05", null)).toBeNull();
  });
});

describe("advanceRecurringReminders — weekly roll-over", () => {
  it("rolls a due weekly reminder forward and stamps the completed occurrence", () => {
    const dataset = defaultDataset();
    dataset.reminders.push(weeklyReminder({ dueDate: "2026-01-03" }));
    const rolled = advanceRecurringReminders(dataset, "2026-01-03");
    expect(rolled).toEqual(["r1"]);
    expect(dataset.reminders[0].dueDate).toBe("2026-01-10");
    expect(dataset.reminders[0].lastCompletedDate).toBe("2026-01-03");
  });

  it("does not roll a weekly reminder that is not yet due", () => {
    const dataset = defaultDataset();
    dataset.reminders.push(weeklyReminder({ dueDate: "2026-06-01" }));
    expect(advanceRecurringReminders(dataset, "2026-01-03")).toEqual([]);
    expect(dataset.reminders[0].dueDate).toBe("2026-06-01");
  });
});

describe("normalizeReminder — v11 repairs", () => {
  it("collapses legacy multi-interval offsets to the first of each kind", () => {
    const reminder = normalizeReminder({
      id: "r1",
      vehicleId: "v1",
      title: "قدیمی",
      type: "date_mileage",
      dueDate: "2026-01-01",
      dueMileage: 100_000,
      notificationOffsets: [{ days: 30 }, { days: 7 }, { days: 1 }, { km: 1000 }, { km: 500 }],
      repeat: "none",
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(reminder?.notificationOffsets).toEqual([{ days: 30 }, { km: 1000 }]);
  });

  it("accepts weekly repeat and repairs the weekday", () => {
    const reminder = normalizeReminder({
      id: "r2",
      vehicleId: "v1",
      title: "هفتگی",
      type: "date",
      dueDate: "2026-01-03",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "weekly",
      repeatWeekday: 3,
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(reminder?.repeat).toBe("weekly");
    expect(reminder?.repeatWeekday).toBe(3);
  });

  it("defaults repeatWeekday to null and drops invalid values", () => {
    const legacy = normalizeReminder({
      id: "r3",
      vehicleId: "v1",
      title: "بدون روز",
      type: "date",
      dueDate: "2026-01-03",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "monthly",
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(legacy?.repeatWeekday).toBeNull();

    const bad = normalizeReminder({
      id: "r4",
      vehicleId: "v1",
      title: "روز نامعتبر",
      type: "date",
      dueDate: "2026-01-03",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "weekly",
      repeatWeekday: 12,
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(bad?.repeatWeekday).toBeNull();

    // repeatWeekday on a non-weekly reminder is normalized away.
    const monthly = normalizeReminder({
      id: "r5",
      vehicleId: "v1",
      title: "ماهانه",
      type: "date",
      dueDate: "2026-01-03",
      dueMileage: null,
      notificationOffsets: [],
      repeat: "monthly",
      repeatWeekday: 2,
      repeatEveryKm: null,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(monthly?.repeatWeekday).toBeNull();
  });
});
