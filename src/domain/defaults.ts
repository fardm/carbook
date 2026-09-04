import type { Dataset, Settings } from "./types";

/** Current schema version. Bump when the dataset shape changes (§40). */
export const CURRENT_VERSION = 2;

export function defaultSettings(): Settings {
  return {
    statusThresholds: {
      dueSoonPercent: 20,
      duePercent: 5,
    },
    theme: "system",
  };
}

/** Empty application dataset at the current schema version (§39). */
export function defaultDataset(): Dataset {
  return {
    version: CURRENT_VERSION,
    exportedAt: null,
    vehicle: null,
    odometerHistory: [],
    maintenanceItems: [],
    serviceHistory: [],
    inspectionHistory: [],
    settings: defaultSettings(),
  };
}