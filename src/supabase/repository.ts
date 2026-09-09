import type { Dataset } from "../domain/types";
import { CURRENT_VERSION, defaultDataset } from "../domain/defaults";
import type { AsyncRepository } from "../persistence/repository";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLOUD_TABLES,
  datasetToItemRows,
  datasetToRecordRows,
  datasetToReminderRows,
  datasetToSettingsRow,
  datasetToVehicleRows,
  rowsToDataset,
  type MaintenanceItemRow,
  type ReminderRow,
  type ServiceRecordRow,
  type SettingsRow,
  type VehicleRow,
} from "./cloud-dataset";

/**
 * Supabase-backed AsyncRepository — the cloud half of the data layer.
 *
 * The WHOLE dataset is read/written per save (the same envelope the local
 * IndexedDB repository persists), translated to per-user rows through
 * cloud-dataset.ts. RLS on every table guarantees a user can only ever
 * touch their own rows; the client holds the publishable (anon) key only.
 *
 * Writes are sequential (vehicles → items → history → reminders → settings)
 * so foreign keys between the user's own rows resolve deterministically.
 */

export class SupabaseRepository implements AsyncRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  /** Loads the user's dataset from Supabase. Any query error (network, RLS
   * misconfiguration) throws so the caller can decide — silently returning
   * defaults would risk OVERWRITING cloud data with an empty dataset. */
  async load(): Promise<Dataset> {
    const [vehicles, items, records, reminders, settings] = await Promise.all([
      this.select<VehicleRow>(CLOUD_TABLES.vehicles),
      this.select<MaintenanceItemRow>(CLOUD_TABLES.maintenanceItems),
      this.select<ServiceRecordRow>(CLOUD_TABLES.serviceHistory),
      this.select<ReminderRow>(CLOUD_TABLES.reminders),
      this.selectOne<SettingsRow>(CLOUD_TABLES.settings),
    ]);
    if (this.isEmptyCloud(vehicles, items, records, reminders, settings)) {
      // Empty account: seed settings so the row exists, and persist the
      // (empty) dataset once — new accounts behave like fresh guests.
      await this.save(defaultDataset());
      return defaultDataset();
    }
    return rowsToDataset(vehicles, items, records, reminders, settings);
  }

  /** Writes the whole dataset. Deletes rows that vanished from the dataset
   * (delete flows remove rows from arrays), upserts everything present. */
  async save(dataset: Dataset): Promise<void> {
    const stamp = { ...dataset, version: CURRENT_VERSION };
    await this.saveVehicles(stamp);
    await this.saveItems(stamp);
    await this.saveRecords(stamp);
    await this.saveReminders(stamp);
    await this.saveSettings(stamp);
  }

  /** Deletes ALL of the user's rows (used by account deletion flows and
   * tests). Guarded by RLS like every other operation. */
  async clear(): Promise<void> {
    await this.deleteFrom(CLOUD_TABLES.serviceHistory);
    await this.deleteFrom(CLOUD_TABLES.maintenanceItems);
    await this.deleteFrom(CLOUD_TABLES.reminders);
    await this.deleteFrom(CLOUD_TABLES.vehicles);
    await this.deleteFrom(CLOUD_TABLES.settings);
  }

  /* ---------------- loaders ---------------- */

  private async select<Row>(table: string): Promise<Row[]> {
    const { data, error } = await this.client.from(table).select("*");
    if (error) throw error;
    return (data ?? []) as Row[];
  }

  private async selectOne<Row>(table: string): Promise<Row | null> {
    const { data, error } = await this.client.from(table).select("*").maybeSingle();
    if (error) throw error;
    return (data as Row | null) ?? null;
  }

  /* ---------------- writers ---------------- */

  private async saveVehicles(dataset: Dataset): Promise<void> {
    const rows = datasetToVehicleRows(dataset, this.userId);
    if (rows.length > 0) await this.upsert(CLOUD_TABLES.vehicles, rows);
    await this.deleteMissing(CLOUD_TABLES.vehicles, rows.map((r) => r.id));
  }

  private async saveItems(dataset: Dataset): Promise<void> {
    const rows = datasetToItemRows(dataset, this.userId);
    if (rows.length > 0) await this.upsert(CLOUD_TABLES.maintenanceItems, rows);
    await this.deleteMissing(CLOUD_TABLES.maintenanceItems, rows.map((r) => r.id));
  }

  private async saveRecords(dataset: Dataset): Promise<void> {
    const rows = datasetToRecordRows(dataset, this.userId);
    if (rows.length > 0) await this.upsert(CLOUD_TABLES.serviceHistory, rows);
    await this.deleteMissing(CLOUD_TABLES.serviceHistory, rows.map((r) => r.id));
  }

  private async saveReminders(dataset: Dataset): Promise<void> {
    const rows = datasetToReminderRows(dataset, this.userId);
    if (rows.length > 0) await this.upsert(CLOUD_TABLES.reminders, rows);
    await this.deleteMissing(CLOUD_TABLES.reminders, rows.map((r) => r.id));
  }

  private async saveSettings(dataset: Dataset): Promise<void> {
    // app_settings is keyed by user_id (one row per user) — there is no `id`
    // column, so the conflict target MUST be user_id. Upserting with an
    // `id` conflict target produced PostgREST error 400 on every save.
    await this.upsert(CLOUD_TABLES.settings, [datasetToSettingsRow(dataset, this.userId)], {
      onConflict: "user_id",
    });
  }

  /** Upserts rows with an explicit conflict target: the primary key of the
   * target table (`id` everywhere except app_settings, which is keyed by
   * user_id). Sending a conflict column that does not exist makes PostgREST
   * reject the request with 400. */
  private async upsert(
    table: string,
    rows: Array<object>,
    options?: { onConflict: string },
  ): Promise<void> {
    const { error } = await this.client
      .from(table)
      .upsert(rows, { onConflict: options?.onConflict ?? "id" });
    if (error) throw error;
  }

  /** Removes rows the dataset no longer contains (scoped to user_id so RLS
   * + the WHERE clause together can never touch other users' data). */
  private async deleteMissing(table: string, keepIds: string[]): Promise<void> {
    if (keepIds.length === 0) {
      await this.deleteFrom(table);
      return;
    }
    const { error } = await this.client
      .from(table)
      .delete()
      .eq("user_id", this.userId)
      .not("id", "in", `(${keepIds.join(",")})`);
    if (error) throw error;
  }

  private async deleteFrom(table: string): Promise<void> {
    const { error } = await this.client.from(table).delete().eq("user_id", this.userId);
    if (error) throw error;
  }

  /* ---------------- helpers ---------------- */

  private isEmptyCloud(
    vehicles: VehicleRow[],
    items: MaintenanceItemRow[],
    records: ServiceRecordRow[],
    reminders: ReminderRow[],
    settings: SettingsRow | null,
  ): boolean {
    return (
      vehicles.length === 0 &&
      items.length === 0 &&
      records.length === 0 &&
      reminders.length === 0 &&
      settings == null
    );
  }
}
