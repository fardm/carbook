import { describe, expect, it } from "vitest";
import {
  countDataset,
  datasetToItemRows,
  datasetToRecordRows,
  datasetToReminderRows,
  datasetToSettingsRow,
  datasetToVehicleRows,
  hasMeaningfulData,
  isUuid,
  rowsToDataset,
  toUuid,
} from "../src/supabase/cloud-dataset";
import { defaultDataset } from "../src/domain/defaults";
import type { Dataset } from "../src/domain/types";
import { createId } from "../src/domain/ids";

/** A populated dataset shaped exactly like what the app persists. */
function populatedDataset(): Dataset {
  const dataset = defaultDataset();
  const vehicleId = createId();
  const itemId = createId();
  const reminderId = createId();
  dataset.vehicles = [
    {
      id: vehicleId,
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
      id: itemId,
      vehicleId,
      catalogId: "engineOil",
      name: "روغن موتور",
      category: "engine",
      icon: "oil",
      rule: { intervalKm: 10000, intervalMonths: 6, trigger: "any", displayMode: "auto" },
      active: true,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
    },
    {
      id: createId(),
      vehicleId: null, // unassigned item
      catalogId: null, // custom item
      name: "بسمه دینام",
      category: "engine",
      icon: "wrench",
      rule: { intervalKm: null, intervalMonths: 12, trigger: "any", displayMode: "time" },
      active: false,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
    },
  ];
  dataset.serviceHistory = [
    {
      id: createId(),
      maintenanceItemId: itemId,
      vehicleId,
      date: "2026-08-20",
      odometer: 100000,
      notes: "روغن 10W-40",
      cost: 850000,
      createdAt: "2026-08-20T08:00:00.000Z",
    },
  ];
  dataset.reminders = [
    {
      id: reminderId,
      vehicleId,
      title: "بیمه بدنه",
      description: "",
      serviceId: null,
      syncWithService: false,
      type: "date_mileage",
      dueDate: "2026-10-01",
      dueMileage: 110000,
      notificationOffsets: [{ days: 3 }, { km: 500 }],
      repeat: "yearly",
      repeatWeekday: null,
      repeatEveryKm: null,
      enabled: true,
      lastCompletedDate: null,
      lastCompletedMileage: null,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
    },
  ];
  dataset.settings.defaultVehicleId = vehicleId;
  return dataset;
}

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("toUuid — deterministic client id conversion", () => {
  it("passes real uuids through unchanged (lowercased)", () => {
    const id = "A1B2C3D4-E5F6-4A1B-8C9D-0123456789AB";
    expect(toUuid(id)).toBe(id.toLowerCase());
  });

  it("maps non-uuid ids to stable uuid-shaped values", () => {
    const a = toUuid("id-legacy-123");
    expect(isUuid(a)).toBe(true);
    expect(toUuid("id-legacy-123")).toBe(a); // deterministic
    expect(toUuid("id-legacy-124")).not.toBe(a); // distinct
  });

  it("is pure — the same id maps identically across calls", () => {
    expect(toUuid("x")).toBe(toUuid("x"));
  });
});

describe("dataset → rows", () => {
  it("maps every vehicle field 1:1 with user_id stamped", () => {
    const dataset = populatedDataset();
    const rows = datasetToVehicleRows(dataset, USER_ID);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.user_id).toBe(USER_ID);
    expect(row.id).toBe(toUuid(dataset.vehicles[0].id));
    expect(row.name).toBe("پژو ۲۰۷");
    expect(row.year).toBe(1390);
    expect(row.current_odometer).toBe(103900);
    expect(row.odometer_updated_at).toBe("2026-09-04T10:00:00.000Z");
  });

  it("maps maintenance items including flattened rule + nullable vehicle/catalog", () => {
    const dataset = populatedDataset();
    const rows = datasetToItemRows(dataset, USER_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0].vehicle_id).toBe(toUuid(dataset.vehicles[0].id));
    expect(rows[0].interval_km).toBe(10000);
    expect(rows[0].interval_months).toBe(6);
    expect(rows[0].trigger).toBe("any");
    expect(rows[1].vehicle_id).toBeNull();
    expect(rows[1].catalog_id).toBeNull();
    expect(rows[1].interval_km).toBeNull();
    expect(rows[1].active).toBe(false);
  });

  it("maps service history with item + vehicle references", () => {
    const dataset = populatedDataset();
    const rows = datasetToRecordRows(dataset, USER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].maintenance_item_id).toBe(toUuid(dataset.maintenanceItems[0].id));
    expect(rows[0].vehicle_id).toBe(toUuid(dataset.vehicles[0].id));
    expect(rows[0].date).toBe("2026-08-20");
    expect(rows[0].cost).toBe(850000);
  });

  it("maps reminders including offsets, repeat, and sync flag", () => {
    const dataset = populatedDataset();
    const rows = datasetToReminderRows(dataset, USER_ID);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.vehicle_id).toBe(toUuid(dataset.vehicles[0].id));
    expect(row.type).toBe("date_mileage");
    expect(row.due_date).toBe("2026-10-01");
    expect(row.due_mileage).toBe(110000);
    expect(row.notification_offsets).toEqual([{ days: 3 }, { km: 500 }]);
    expect(row.repeat).toBe("yearly");
    expect(row.sync_with_service).toBe(false);
  });

  it("maps settings with threshold + preferences + default vehicle", () => {
    const dataset = populatedDataset();
    const row = datasetToSettingsRow(dataset, USER_ID);
    expect(row.user_id).toBe(USER_ID);
    expect(row.due_soon_percent).toBe(20);
    expect(row.due_percent).toBe(5);
    expect(row.theme).toBe("system");
    expect(row.calendar).toBe("jalali");
    expect(row.currency).toBe("IRR");
    expect(row.default_vehicle_id).toBe(toUuid(dataset.settings.defaultVehicleId!));
  });

  it("keeps references consistent: item.vehicle_id equals vehicle row id", () => {
    const dataset = populatedDataset();
    const vehicles = datasetToVehicleRows(dataset, USER_ID);
    const items = datasetToItemRows(dataset, USER_ID);
    const records = datasetToRecordRows(dataset, USER_ID);
    expect(items[0].vehicle_id).toBe(vehicles[0].id);
    expect(records[0].vehicle_id).toBe(vehicles[0].id);
    expect(records[0].maintenance_item_id).toBe(items[0].id);
  });
});

describe("rows → dataset", () => {
  it("round-trips a populated dataset without loss", () => {
    const dataset = populatedDataset();
    const restored = rowsToDataset(
      datasetToVehicleRows(dataset, USER_ID),
      datasetToItemRows(dataset, USER_ID),
      datasetToRecordRows(dataset, USER_ID),
      datasetToReminderRows(dataset, USER_ID),
      datasetToSettingsRow(dataset, USER_ID),
    );
    expect(restored.vehicles).toEqual(dataset.vehicles);
    expect(restored.maintenanceItems).toEqual(dataset.maintenanceItems);
    expect(restored.serviceHistory).toEqual(dataset.serviceHistory);
    expect(restored.reminders).toEqual(dataset.reminders);
    expect(restored.settings).toEqual(dataset.settings);
    expect(restored.version).toBe(defaultDataset().version);
  });

  it("yields defaults (except exportedAt null) for empty cloud tables", () => {
    const restored = rowsToDataset([], [], [], [], null);
    expect(restored).toEqual(defaultDataset());
  });

  it("keeps unassigned items unassigned (null vehicleId)", () => {
    const dataset = populatedDataset();
    const restored = rowsToDataset(
      datasetToVehicleRows(dataset, USER_ID),
      datasetToItemRows(dataset, USER_ID),
      [],
      [],
      null,
    );
    expect(restored.maintenanceItems[1].vehicleId).toBeNull();
  });
});

describe("dataset counting / meaningfulness", () => {
  it("empty dataset has no meaningful data", () => {
    expect(hasMeaningfulData(defaultDataset())).toBe(false);
  });

  it("any entity makes the dataset meaningful", () => {
    const withVehicle = defaultDataset();
    withVehicle.vehicles.push({
      id: createId(),
      name: "x",
      make: "",
      model: "",
      year: null,
      fuelType: null,
      averageAnnualDistance: null,
      currentOdometer: null,
      odometerUpdatedAt: null,
      createdAt: "",
      updatedAt: "",
    });
    expect(hasMeaningfulData(withVehicle)).toBe(true);
  });

  it("counts each entity type", () => {
    const counts = countDataset(populatedDataset());
    expect(counts).toEqual({ vehicles: 1, items: 2, services: 1, reminders: 1 });
  });
});
