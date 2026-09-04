import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, defaultDataset } from "../src/domain/defaults";
import type { Dataset } from "../src/domain/types";
import {
  backupFilename,
  buildExport,
  serializeExport,
  validateImportText,
  type ImportIssueKind,
} from "../src/persistence/import-export";

/** A fully populated, schema-valid dataset (§41 shape, multi-vehicle). */
function validDataset(): Dataset {
  const d = defaultDataset();
  d.exportedAt = "2026-09-04T10:30:00.000Z";
  d.vehicles = [
    {
      id: "v1",
      name: "پژو ۲۰۷",
      make: "پژو",
      model: "207",
      year: 1390, // Solar Hijri production year is valid
      fuelType: "gasoline",
      averageDailyDistance: 40,
      currentOdometer: 104500,
      odometerUpdatedAt: "2026-09-01T08:00:00.000Z",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    },
  ];
  d.maintenanceItems = [
    {
      id: "m1",
      vehicleId: "v1",
      catalogId: "engineOil",
      name: "روغن موتور",
      category: "engine",
      icon: "droplets",
      rule: {
        intervalKm: 10000,
        intervalMonths: 6,
        trigger: "any",
        displayMode: "auto",
        inspectionBased: false,
      },
      active: true,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ];
  d.serviceHistory = [
    {
      id: "s1",
      maintenanceItemId: "m1",
      vehicleId: "v1",
      date: "2026-06-01",
      odometer: 94500,
      notes: "روغن 10W-40",
      cost: 520000,
      createdAt: "2026-06-01T08:00:00.000Z",
    },
  ];
  d.inspectionHistory = [
    {
      id: "i1",
      maintenanceItemId: "m1",
      vehicleId: "v1",
      date: "2026-09-01",
      odometer: 104500,
      condition: "watch",
      measurement: null,
      notes: "",
      createdAt: "2026-09-01T11:00:00.000Z",
    },
  ];
  return d;
}

/** A deep-cloned mutable copy of the valid dataset (as parsed JSON). */
function cloneValid(): Dataset {
  return JSON.parse(serializeExport(validDataset())) as Dataset;
}

const textOf = (d: Dataset): string => JSON.stringify(d);

/** Asserts the text is rejected with at least the given issue. */
function expectIssue(text: string, path: string, kind: ImportIssueKind): void {
  const result = validateImportText(text);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const found = result.issues.some(
    (issue) => issue.path === path && issue.kind === kind,
  );
  expect(found, JSON.stringify(result.issues)).toBe(true);
}

function validText(): string {
  return textOf(validDataset());
}

describe("export helpers (§41)", () => {
  it("buildExport stamps exportedAt and the current version", () => {
    const dataset = validDataset();
    dataset.version = 999;
    dataset.exportedAt = "2020-01-01T00:00:00.000Z";
    const exported = buildExport(dataset, "2026-09-04T12:00:00.000Z");
    expect(exported.version).toBe(CURRENT_VERSION);
    expect(exported.exportedAt).toBe("2026-09-04T12:00:00.000Z");
    expect(exported.vehicles).toEqual(dataset.vehicles);
    expect(exported.maintenanceItems).toEqual(dataset.maintenanceItems);
  });

  it("serializeExport produces parseable JSON equal to the dataset", () => {
    const dataset = validDataset();
    expect(JSON.parse(serializeExport(dataset))).toEqual(dataset);
  });

  it("serializeExport pretty-prints", () => {
    expect(serializeExport(validDataset())).toContain("\n  ");
  });

  it("backupFilename uses the given date", () => {
    expect(backupFilename("2026-09-04")).toBe("car-maintenance-backup-2026-09-04.json");
  });
});

describe("validateImportText — round trip (§49: export → import → equivalent)", () => {
  it("accepts the canonical export and returns an equal dataset", () => {
    const original = validDataset();
    const result = validateImportText(validText());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset).toEqual(original);
  });

  it("accepts an empty (default) dataset", () => {
    const d = defaultDataset();
    const result = validateImportText(serializeExport(d));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset).toEqual(d);
  });

  it("migrates a legacy single-vehicle file (same migration table as loading)", () => {
    // A pre-multi-vehicle backup: singular `vehicle` + `odometerHistory`,
    // items/records with NO vehicleId (v4 links them to the vehicle).
    const d = cloneValid();
    d.version = 0;
    const legacy = d as unknown as Record<string, unknown>;
    legacy.vehicle = d.vehicles[0];
    legacy.odometerHistory = [];
    delete legacy.vehicles;
    for (const row of d.maintenanceItems) delete (row as { vehicleId?: string }).vehicleId;
    for (const row of d.serviceHistory) delete (row as { vehicleId?: string }).vehicleId;
    for (const row of d.inspectionHistory) delete (row as { vehicleId?: string }).vehicleId;
    const result = validateImportText(textOf(d));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.version).toBe(CURRENT_VERSION);
    expect(result.dataset.vehicles[0].id).toBe("v1");
    expect(result.dataset.vehicles[0].name).toBe("پژو ۲۰۷");
    // Items/records were linked to the migrated vehicle.
    expect(result.dataset.maintenanceItems[0].vehicleId).toBe("v1");
    expect(result.dataset.serviceHistory[0].vehicleId).toBe("v1");
    expect(result.dataset.inspectionHistory[0].vehicleId).toBe("v1");
  });

  it("tolerates extra unknown top-level keys (forward-compatible within a version)", () => {
    const raw = JSON.parse(validText()) as Record<string, unknown>;
    raw.futureField = { anything: true };
    expect(validateImportText(JSON.stringify(raw)).ok).toBe(true);
  });
});

describe("validateImportText — root & version gate (§40, §47)", () => {
  it("rejects invalid JSON", () => {
    expectIssue("{oops", "", "notJson");
  });

  it("rejects non-object roots", () => {
    expectIssue("[1,2,3]", "", "notObject");
    expectIssue('"hello"', "", "notObject");
    expectIssue("42", "", "notObject");
  });

  it("rejects a missing version field", () => {
    const raw = JSON.parse(validText()) as Record<string, unknown>;
    delete raw.version;
    expectIssue(JSON.stringify(raw), "version", "missingField");
  });

  it("rejects a non-number version", () => {
    const raw = JSON.parse(validText()) as Record<string, unknown>;
    raw.version = "1";
    expectIssue(JSON.stringify(raw), "version", "wrongType");
  });

  it("rejects fractional/negative versions", () => {
    const raw = JSON.parse(validText()) as Record<string, unknown>;
    raw.version = 1.5;
    expectIssue(JSON.stringify(raw), "version", "invalidValue");
    raw.version = -1;
    expectIssue(JSON.stringify(raw), "version", "invalidValue");
  });

  it("rejects a future (unsupported) version without touching anything else", () => {
    const raw = JSON.parse(validText()) as Record<string, unknown>;
    raw.version = 99;
    expectIssue(JSON.stringify(raw), "version", "unsupportedVersion");
  });
});

describe("validateImportText — structure & types (§42, §47)", () => {
  it("rejects a missing required top-level field", () => {
    const raw = JSON.parse(validText()) as Record<string, unknown>;
    delete raw.settings;
    expectIssue(JSON.stringify(raw), "settings", "missingField");
  });

  it("rejects a wrong-typed top-level array", () => {
    const d = cloneValid();
    (d as unknown as Record<string, unknown>).vehicles = "nope";
    expectIssue(textOf(d), "vehicles", "wrongType");
  });

  it("rejects a wrong-typed exportedAt", () => {
    const d = cloneValid();
    (d as unknown as Record<string, unknown>).exportedAt = 42;
    expectIssue(textOf(d), "exportedAt", "wrongType");
  });

  it("rejects an unparseable exportedAt string", () => {
    const d = cloneValid();
    d.exportedAt = "not-a-date";
    expectIssue(textOf(d), "exportedAt", "invalidValue");
  });
});

describe("validateImportText — vehicles", () => {
  it("rejects a missing vehicle name", () => {
    const d = cloneValid();
    delete (d.vehicles[0] as unknown as Record<string, unknown>).name;
    expectIssue(textOf(d), "vehicles[0].name", "missingField");
  });

  it("rejects a blank vehicle name", () => {
    const d = cloneValid();
    d.vehicles[0].name = "   ";
    expectIssue(textOf(d), "vehicles[0].name", "invalidValue");
  });

  it("rejects a wrong-typed vehicle field", () => {
    const d = cloneValid();
    (d.vehicles[0] as unknown as Record<string, unknown>).make = 7;
    expectIssue(textOf(d), "vehicles[0].make", "wrongType");
  });

  it("accepts a Solar Hijri production year (1390)", () => {
    const d = cloneValid();
    d.vehicles[0].year = 1390;
    expect(validateImportText(textOf(d)).ok).toBe(true);
  });

  it("accepts a Gregorian production year (2019)", () => {
    const d = cloneValid();
    d.vehicles[0].year = 2019;
    expect(validateImportText(textOf(d)).ok).toBe(true);
  });

  it("rejects an out-of-range year in either calendar system", () => {
    const d = cloneValid();
    d.vehicles[0].year = 1800;
    expectIssue(textOf(d), "vehicles[0].year", "invalidValue");
    d.vehicles[0].year = 9999;
    expectIssue(textOf(d), "vehicles[0].year", "invalidValue");
  });

  it("rejects an unknown fuel type", () => {
    const d = cloneValid();
    (d.vehicles[0] as unknown as Record<string, unknown>).fuelType = "ethanol";
    expectIssue(textOf(d), "vehicles[0].fuelType", "invalidValue");
  });

  it("rejects a negative average daily distance", () => {
    const d = cloneValid();
    d.vehicles[0].averageDailyDistance = -5;
    expectIssue(textOf(d), "vehicles[0].averageDailyDistance", "invalidValue");
  });

  it("rejects a negative or fractional current odometer", () => {
    const d = cloneValid();
    d.vehicles[0].currentOdometer = -1;
    expectIssue(textOf(d), "vehicles[0].currentOdometer", "invalidValue");
    d.vehicles[0].currentOdometer = 12.5;
    expectIssue(textOf(d), "vehicles[0].currentOdometer", "invalidValue");
  });

  it("accepts a null current odometer (mileage never recorded)", () => {
    const d = cloneValid();
    d.vehicles[0].currentOdometer = null;
    expect(validateImportText(textOf(d)).ok).toBe(true);
  });

  it("rejects duplicate vehicle ids", () => {
    const d = cloneValid();
    d.vehicles.push({ ...d.vehicles[0], name: "دیگر" });
    expectIssue(textOf(d), "vehicles[1].id", "duplicateId");
  });
});

describe("validateImportText — maintenance items & rules", () => {
  it("rejects duplicate item ids", () => {
    const d = cloneValid();
    d.maintenanceItems.push(JSON.parse(JSON.stringify(d.maintenanceItems[0])) as Dataset["maintenanceItems"][number]);
    expectIssue(textOf(d), "maintenanceItems[1].id", "duplicateId");
  });

  it("rejects an item referencing an unknown vehicle", () => {
    const d = cloneValid();
    d.maintenanceItems[0].vehicleId = "ghost-vehicle";
    expectIssue(textOf(d), "maintenanceItems[0].vehicleId", "unknownReference");
  });

  it("accepts a null vehicleId (legacy unassigned item)", () => {
    const d = cloneValid();
    d.maintenanceItems[0].vehicleId = null;
    expect(validateImportText(textOf(d)).ok).toBe(true);
  });

  it("rejects a missing rule object", () => {
    const d = cloneValid();
    delete (d.maintenanceItems[0] as unknown as Record<string, unknown>).rule;
    expectIssue(textOf(d), "maintenanceItems[0].rule", "missingField");
  });

  it("rejects a negative or fractional km interval", () => {
    const d = cloneValid();
    d.maintenanceItems[0].rule.intervalKm = -1000;
    expectIssue(textOf(d), "maintenanceItems[0].rule.intervalKm", "invalidValue");
    d.maintenanceItems[0].rule.intervalKm = 10.5;
    expectIssue(textOf(d), "maintenanceItems[0].rule.intervalKm", "invalidValue");
  });

  it("rejects an unknown displayMode", () => {
    const d = cloneValid();
    (d.maintenanceItems[0].rule as unknown as Record<string, unknown>).displayMode = "weeks";
    expectIssue(textOf(d), "maintenanceItems[0].rule.displayMode", "invalidValue");
  });

  it("rejects an unknown trigger", () => {
    const d = cloneValid();
    (d.maintenanceItems[0].rule as unknown as Record<string, unknown>).trigger = "all";
    expectIssue(textOf(d), "maintenanceItems[0].rule.trigger", "invalidValue");
  });

  it("rejects a rule with no tracking criterion (§16/§37)", () => {
    const d = cloneValid();
    d.maintenanceItems[0].rule.intervalKm = null;
    d.maintenanceItems[0].rule.intervalMonths = null;
    d.maintenanceItems[0].rule.inspectionBased = false;
    expectIssue(textOf(d), "maintenanceItems[0].rule", "invalidValue");
  });

  it("rejects a non-boolean inspectionBased flag", () => {
    const d = cloneValid();
    (d.maintenanceItems[0].rule as unknown as Record<string, unknown>).inspectionBased = "yes";
    expectIssue(textOf(d), "maintenanceItems[0].rule.inspectionBased", "wrongType");
  });

  it("rejects a non-boolean active flag", () => {
    const d = cloneValid();
    (d.maintenanceItems[0] as unknown as Record<string, unknown>).active = "true";
    expectIssue(textOf(d), "maintenanceItems[0].active", "wrongType");
  });
});

describe("validateImportText — service & inspection history", () => {
  it("rejects a service referencing an unknown item", () => {
    const d = cloneValid();
    d.serviceHistory[0].maintenanceItemId = "ghost-item";
    expectIssue(textOf(d), "serviceHistory[0].maintenanceItemId", "unknownReference");
  });

  it("rejects a service referencing an unknown vehicle", () => {
    const d = cloneValid();
    d.serviceHistory[0].vehicleId = "ghost-vehicle";
    expectIssue(textOf(d), "serviceHistory[0].vehicleId", "unknownReference");
  });

  it("rejects duplicate service ids", () => {
    const d = cloneValid();
    d.serviceHistory.push({ ...d.serviceHistory[0], date: "2026-07-01" });
    expectIssue(textOf(d), "serviceHistory[1].id", "duplicateId");
  });

  it("rejects a negative service cost", () => {
    const d = cloneValid();
    d.serviceHistory[0].cost = -5;
    expectIssue(textOf(d), "serviceHistory[0].cost", "invalidValue");
  });

  it("rejects a wrong-typed cost", () => {
    const d = cloneValid();
    (d.serviceHistory[0] as unknown as Record<string, unknown>).cost = "۵۰۰";
    expectIssue(textOf(d), "serviceHistory[0].cost", "wrongType");
  });

  it("rejects an unknown inspection condition", () => {
    const d = cloneValid();
    (d.inspectionHistory[0] as unknown as Record<string, unknown>).condition = "perfect";
    expectIssue(textOf(d), "inspectionHistory[0].condition", "invalidValue");
  });

  it("rejects a negative measurement", () => {
    const d = cloneValid();
    d.inspectionHistory[0].measurement = -2;
    expectIssue(textOf(d), "inspectionHistory[0].measurement", "invalidValue");
  });

  it("rejects an inspection referencing an unknown item", () => {
    const d = cloneValid();
    d.inspectionHistory[0].maintenanceItemId = "ghost-item";
    expectIssue(textOf(d), "inspectionHistory[0].maintenanceItemId", "unknownReference");
  });

  it("accepts a null condition (model allows it; entry validation is stricter)", () => {
    const d = cloneValid();
    d.inspectionHistory[0].condition = null;
    expect(validateImportText(textOf(d)).ok).toBe(true);
  });
});

describe("validateImportText — settings", () => {
  it("rejects missing statusThresholds", () => {
    const d = cloneValid();
    delete (d.settings as unknown as Record<string, unknown>).statusThresholds;
    expectIssue(textOf(d), "settings.statusThresholds", "missingField");
  });

  it("rejects out-of-range threshold percentages", () => {
    const d = cloneValid();
    d.settings.statusThresholds.dueSoonPercent = 150;
    expectIssue(textOf(d), "settings.statusThresholds.dueSoonPercent", "invalidValue");
  });

  it("rejects duePercent above dueSoonPercent", () => {
    const d = cloneValid();
    d.settings.statusThresholds = { dueSoonPercent: 10, duePercent: 30 };
    expectIssue(textOf(d), "settings.statusThresholds", "invalidValue");
  });

  it("rejects a missing or unknown theme preference", () => {
    const missing = cloneValid();
    delete (missing.settings as unknown as Record<string, unknown>).theme;
    expectIssue(textOf(missing), "settings.theme", "missingField");
    const unknown = cloneValid();
    (unknown.settings as unknown as Record<string, unknown>).theme = "sepia";
    expectIssue(textOf(unknown), "settings.theme", "invalidValue");
  });

  it("accepts every theme preference", () => {
    for (const theme of ["system", "light", "dark"]) {
      const d = cloneValid();
      (d.settings as unknown as Record<string, unknown>).theme = theme;
      expect(validateImportText(textOf(d)).ok).toBe(true);
    }
  });

  it("accepts both calendar preferences and rejects unknown ones", () => {
    for (const calendar of ["jalali", "gregorian"]) {
      const d = cloneValid();
      (d.settings as unknown as Record<string, unknown>).calendar = calendar;
      expect(validateImportText(textOf(d)).ok).toBe(true);
    }
    const d = cloneValid();
    (d.settings as unknown as Record<string, unknown>).calendar = "buddhist";
    expectIssue(textOf(d), "settings.calendar", "invalidValue");
  });
});

describe("validateImportText — reporting", () => {
  it("reports every problem found in one pass", () => {
    const d = cloneValid();
    d.vehicles[0].name = "";
    d.vehicles[0].currentOdometer = -10;
    d.maintenanceItems[0].rule.displayMode = "weeks" as Dataset["maintenanceItems"][number]["rule"]["displayMode"];
    const result = validateImportText(textOf(d));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((issue) => issue.path);
    expect(paths).toContain("vehicles[0].name");
    expect(paths).toContain("vehicles[0].currentOdometer");
    expect(paths).toContain("maintenanceItems[0].rule.displayMode");
  });
});

describe("failure is atomic", () => {
  it("an invalid file yields no dataset to replace with", () => {
    const result = validateImportText("{broken");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The caller contract: issues only, never a partial dataset.
    expect(result.issues.length).toBeGreaterThan(0);
  });
});