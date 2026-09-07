import type { Dataset, Settings } from "./types";

/** Current schema version. Bump when the dataset shape changes (§40).
 * v11: repeat gains "weekly" + per-reminder repeatWeekday; notification
 * offsets become at most one per kind (normalized defensively on load). */
export const CURRENT_VERSION = 11;

export function defaultSettings(): Settings {
  return {
    statusThresholds: {
      dueSoonPercent: 20,
      duePercent: 5,
    },
    theme: "system",
    // Default calendar: Solar Hijri (شمسی) per product requirements.
    calendar: "jalali",
    // Default currency: تومان (IRR). The setting only labels service costs.
    currency: "IRR",
    // No default vehicle until the user picks one (نقشه: انتخاب به عنوان پیشفرض).
    defaultVehicleId: null,
  };
}

/** Empty application dataset at the current schema version (§39). */
export function defaultDataset(): Dataset {
  return {
    version: CURRENT_VERSION,
    exportedAt: null,
    vehicles: [],
    maintenanceItems: [],
    serviceHistory: [],
    reminders: [],
    settings: defaultSettings(),
  };
}