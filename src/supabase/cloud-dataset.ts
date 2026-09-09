import type { Dataset } from "../domain/types";
import { defaultDataset, CURRENT_VERSION } from "../domain/defaults";
import { normalizeReminders } from "../persistence/reminder-normalize";
import type {
  MaintenanceItem,
  MaintenanceRule,
  NotificationOffset,
  Reminder,
  ServiceRecord,
  Settings,
  Vehicle,
} from "../domain/types";

/**
 * Cloud dataset mapping — the ONLY translation between the app's Dataset
 * envelope (exactly the shape IndexedDB stores) and per-user Supabase rows.
 *
 * The schema mirrors the ACTUAL data model — no parallel or simplified
 * variant: every entity keeps its client-generated id (a string, stored in a
 * uuid-typed column; guest ids that are not uuid-shaped are deterministically
 * converted, see toUuid), every field maps 1:1, and relations keep the same
 * semantics (vehicleId nullable = unassigned).
 */

export interface AuthIdentity {
  userId: string;
}

/* ------------------------------------------------------------------ */
/* Column names (must match supabase/schema.sql)                       */
/* ------------------------------------------------------------------ */

export const CLOUD_TABLES = {
  vehicles: "vehicles",
  maintenanceItems: "maintenance_items",
  serviceHistory: "service_history",
  reminders: "reminders",
  settings: "app_settings",
} as const;

/* ------------------------------------------------------------------ */
/* Deterministic uuid for client-generated ids                         */
/* ------------------------------------------------------------------ */

/**
 * New rows are created with crypto.randomUUID() (the existing createId()),
 * which is already a valid uuid. Data imported from older JSON exports may
 * carry non-uuid ids ("id-…"), so any non-uuid id is mapped deterministically
 * to a uuid (v5-style via two MD-free hashing passes with crypto.getRandomValues
 * avoided — we use a stable FNV-based scheme so the mapping is pure and
 * idempotent for tests).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stable namespace that separates CarBook ids from other uuid uses. */
const ID_NAMESPACE = "carbook-id-v1";

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** FNV-1a 32-bit → hex, chained with a salt for extra passes. */
function fnv1a(input: string, salt: number): number {
  let hash = 0x811c9dc5 ^ salt;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministically converts ANY string id to a stable uuid-shaped string. */
export function toUuid(value: string): string {
  if (isUuid(value)) return value.toLowerCase();
  const a = fnv1a(ID_NAMESPACE + "|" + value, 0x01);
  const b = fnv1a(ID_NAMESPACE + "|" + value, 0x02);
  const c = fnv1a(ID_NAMESPACE + "|" + value, 0x03);
  const d = fnv1a(ID_NAMESPACE + "|" + value, 0x04);
  const hex = a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0") + c.toString(16).padStart(8, "0") + d.toString(16).padStart(8, "0");
  // Version 4 + variant bits so the result is a well-formed uuid.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/* ------------------------------------------------------------------ */
/* Row types (snake_case mirrors of the domain interfaces)             */
/* ------------------------------------------------------------------ */

export interface VehicleRow {
  id: string;
  user_id: string;
  name: string;
  make: string;
  model: string;
  year: number | null;
  fuel_type: string | null;
  average_annual_distance: number | null;
  current_odometer: number | null;
  odometer_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceItemRow {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  catalog_id: string | null;
  name: string;
  category: string;
  icon: string;
  interval_km: number | null;
  interval_months: number | null;
  trigger: string;
  display_mode: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceRecordRow {
  id: string;
  user_id: string;
  maintenance_item_id: string;
  vehicle_id: string | null;
  date: string;
  odometer: number | null;
  notes: string;
  cost: number | null;
  created_at: string;
}

export interface ReminderRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  title: string;
  description: string;
  service_id: string | null;
  sync_with_service: boolean;
  type: string;
  due_date: string | null;
  due_mileage: number | null;
  notification_offsets: NotificationOffset[] | null;
  repeat: string;
  repeat_weekday: number | null;
  repeat_every_km: number | null;
  enabled: boolean;
  last_completed_date: string | null;
  last_completed_mileage: number | null;
  created_at: string;
  updated_at: string;
}

export interface SettingsRow {
  user_id: string;
  due_soon_percent: number;
  due_percent: number;
  theme: string;
  calendar: string;
  currency: string;
  default_vehicle_id: string | null;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Dataset → rows                                                      */
/* ------------------------------------------------------------------ */

export function datasetToVehicleRows(dataset: Dataset, userId: string): VehicleRow[] {
  return dataset.vehicles.map((v) => ({
    id: toUuid(v.id),
    user_id: userId,
    name: v.name,
    make: v.make,
    model: v.model,
    year: v.year,
    fuel_type: v.fuelType,
    average_annual_distance: v.averageAnnualDistance,
    current_odometer: v.currentOdometer,
    odometer_updated_at: v.odometerUpdatedAt,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
  }));
}

export function datasetToItemRows(dataset: Dataset, userId: string): MaintenanceItemRow[] {
  return dataset.maintenanceItems.map((item) => ({
    id: toUuid(item.id),
    user_id: userId,
    vehicle_id: item.vehicleId ? toUuid(item.vehicleId) : null,
    catalog_id: item.catalogId,
    name: item.name,
    category: item.category,
    icon: item.icon,
    interval_km: item.rule.intervalKm,
    interval_months: item.rule.intervalMonths,
    trigger: item.rule.trigger,
    display_mode: item.rule.displayMode,
    active: item.active,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }));
}

export function datasetToRecordRows(dataset: Dataset, userId: string): ServiceRecordRow[] {
  return dataset.serviceHistory.map((record) => ({
    id: toUuid(record.id),
    user_id: userId,
    maintenance_item_id: toUuid(record.maintenanceItemId),
    vehicle_id: record.vehicleId ? toUuid(record.vehicleId) : null,
    date: record.date,
    odometer: record.odometer,
    notes: record.notes,
    cost: record.cost,
    created_at: record.createdAt,
  }));
}

export function datasetToReminderRows(dataset: Dataset, userId: string): ReminderRow[] {
  return dataset.reminders.map((reminder) => ({
    id: toUuid(reminder.id),
    user_id: userId,
    vehicle_id: toUuid(reminder.vehicleId),
    title: reminder.title,
    description: reminder.description,
    service_id: reminder.serviceId ? toUuid(reminder.serviceId) : null,
    sync_with_service: reminder.syncWithService,
    type: reminder.type,
    due_date: reminder.dueDate,
    due_mileage: reminder.dueMileage,
    notification_offsets: reminder.notificationOffsets,
    repeat: reminder.repeat,
    repeat_weekday: reminder.repeatWeekday,
    repeat_every_km: reminder.repeatEveryKm,
    enabled: reminder.enabled,
    last_completed_date: reminder.lastCompletedDate,
    last_completed_mileage: reminder.lastCompletedMileage,
    created_at: reminder.createdAt,
    updated_at: reminder.updatedAt,
  }));
}

export function datasetToSettingsRow(dataset: Dataset, userId: string): SettingsRow {
  const thresholds = dataset.settings.statusThresholds;
  return {
    user_id: userId,
    due_soon_percent: thresholds.dueSoonPercent,
    due_percent: thresholds.duePercent,
    theme: dataset.settings.theme,
    calendar: dataset.settings.calendar,
    currency: dataset.settings.currency,
    default_vehicle_id: dataset.settings.defaultVehicleId
      ? toUuid(dataset.settings.defaultVehicleId)
      : null,
    updated_at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Rows → Dataset                                                      */
/* ------------------------------------------------------------------ */

/** Rows are defensively re-normalized through the same loaders the local
 * persistence uses, so partially-shaped cloud data can never crash the app. */
export function rowsToDataset(
  vehicles: VehicleRow[],
  items: MaintenanceItemRow[],
  records: ServiceRecordRow[],
  reminders: ReminderRow[],
  settings: SettingsRow | null,
): Dataset {
  return {
    version: CURRENT_VERSION,
    exportedAt: null,
    vehicles: vehicles.map(rowToVehicle),
    maintenanceItems: items.map(rowToItem),
    serviceHistory: records.map(rowToRecord),
    reminders: normalizeReminders(reminders.map(rowToReminder)),
    settings: settings ? rowToSettings(settings) : defaultDataset().settings,
  };
}

function rowToVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id.toLowerCase(),
    name: row.name,
    make: row.make,
    model: row.model,
    year: row.year != null ? Number(row.year) : null,
    fuelType: (row.fuel_type as Vehicle["fuelType"]) ?? null,
    averageAnnualDistance: row.average_annual_distance != null ? Number(row.average_annual_distance) : null,
    currentOdometer: row.current_odometer != null ? Number(row.current_odometer) : null,
    odometerUpdatedAt: row.odometer_updated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToItem(row: MaintenanceItemRow): MaintenanceItem {
  const rule: MaintenanceRule = {
    intervalKm: row.interval_km != null ? Number(row.interval_km) : null,
    intervalMonths: row.interval_months != null ? Number(row.interval_months) : null,
    trigger: (row.trigger as MaintenanceRule["trigger"]) ?? "any",
    displayMode: (row.display_mode as MaintenanceRule["displayMode"]) ?? "auto",
  };
  return {
    id: row.id.toLowerCase(),
    vehicleId: row.vehicle_id ? row.vehicle_id.toLowerCase() : null,
    catalogId: row.catalog_id ?? null,
    name: row.name,
    category: row.category,
    icon: row.icon,
    rule,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRecord(row: ServiceRecordRow): ServiceRecord {
  return {
    id: row.id.toLowerCase(),
    maintenanceItemId: row.maintenance_item_id.toLowerCase(),
    vehicleId: row.vehicle_id ? row.vehicle_id.toLowerCase() : null,
    date: row.date,
    odometer: row.odometer != null ? Number(row.odometer) : null,
    notes: row.notes,
    cost: row.cost != null ? Number(row.cost) : null,
    createdAt: row.created_at,
  };
}

function rowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id.toLowerCase(),
    vehicleId: row.vehicle_id.toLowerCase(),
    title: row.title,
    description: row.description,
    serviceId: row.service_id ? row.service_id.toLowerCase() : null,
    syncWithService: row.sync_with_service,
    type: (row.type as Reminder["type"]) ?? "date",
    dueDate: row.due_date ?? null,
    dueMileage: row.due_mileage != null ? Number(row.due_mileage) : null,
    notificationOffsets: Array.isArray(row.notification_offsets)
      ? (row.notification_offsets as NotificationOffset[])
      : [],
    repeat: (row.repeat as Reminder["repeat"]) ?? "none",
    repeatWeekday: row.repeat_weekday != null ? Number(row.repeat_weekday) : null,
    repeatEveryKm: row.repeat_every_km != null ? Number(row.repeat_every_km) : null,
    enabled: row.enabled,
    lastCompletedDate: row.last_completed_date ?? null,
    lastCompletedMileage: row.last_completed_mileage != null ? Number(row.last_completed_mileage) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSettings(row: SettingsRow): Settings {
  return {
    statusThresholds: {
      dueSoonPercent: row.due_soon_percent != null ? Number(row.due_soon_percent) : 20,
      duePercent: row.due_percent != null ? Number(row.due_percent) : 5,
    },
    theme: row.theme as Settings["theme"],
    calendar: row.calendar as Settings["calendar"],
    currency: row.currency as Settings["currency"],
    defaultVehicleId: row.default_vehicle_id ? row.default_vehicle_id.toLowerCase() : null,
  };
}

/* ------------------------------------------------------------------ */
/* Shared row helpers                                                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Migration support: counts + id conversion of a local dataset        */
/* ------------------------------------------------------------------ */

/** Describes a local (guest) dataset for the migration prompt. */
export interface DatasetCounts {
  vehicles: number;
  items: number;
  services: number;
  reminders: number;
}

export function countDataset(dataset: Dataset): DatasetCounts {
  return {
    vehicles: dataset.vehicles.length,
    items: dataset.maintenanceItems.length,
    services: dataset.serviceHistory.length,
    reminders: dataset.reminders.length,
  };
}

/** True when the guest dataset holds anything the user would notice losing. */
export function hasMeaningfulData(dataset: Dataset): boolean {
  return (
    dataset.vehicles.length > 0 ||
    dataset.maintenanceItems.length > 0 ||
    dataset.serviceHistory.length > 0 ||
    dataset.reminders.length > 0
  );
}
