import type { Dataset } from "../domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countDataset, CLOUD_TABLES, hasMeaningfulData, type DatasetCounts } from "./cloud-dataset";
import { SupabaseRepository } from "./repository";

/**
 * Guest → account migration (one-time, opt-in).
 *
 * Offered right after a guest with local IndexedDB data signs in or signs
 * up. Safety rules:
 *   - The local dataset is NEVER deleted or modified by migration. After a
 *     successful upload the guest envelope simply stays where it is — guest
 *     mode keeps working exactly as before if the user logs out.
 *   - An account that ALREADY holds data is never blindly overwritten: the
 *     migration refuses (status "conflict") and the UI explains the options
 *     instead of replacing cloud data.
 *   - Any Supabase failure aborts the migration with local data untouched
 *     (status "error") — the user can retry from the account modal.
 */

export type MigrationStatus = "migrated" | "conflict" | "error" | "empty";

export interface MigrationResult {
  status: MigrationStatus;
  /** Row counts that were uploaded (status "migrated") or offered (others). */
  counts: DatasetCounts;
  /** True when the account already had data (status "conflict"). */
  cloudAlreadyHasData?: boolean;
}

/** Whether the account's DATA tables hold any rows (settings excluded —
 * an empty account is seeded with a settings row on first load).
 *
 * Exported so the UI can decide whether to OFFER the guest→account
 * transfer at all: the offer must only appear when the account is empty.
 * Throws on a query error (network/RLS) — callers must treat an unconfirmed
 * account as non-empty and simply not offer anything. */
export async function cloudAccountHasData(client: SupabaseClient, userId: string): Promise<boolean> {
  const tables = [
    CLOUD_TABLES.vehicles,
    CLOUD_TABLES.maintenanceItems,
    CLOUD_TABLES.serviceHistory,
    CLOUD_TABLES.reminders,
  ] as const;
  for (const table of tables) {
    const { count, error } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Offers and performs the migration of the guest dataset to the signed-in
 * account. Returns the outcome; never throws — failures are reported as
 * status "error" so the caller can show a friendly message.
 */
export async function migrateGuestDataToCloud(
  client: SupabaseClient,
  userId: string,
  localDataset: Dataset,
): Promise<MigrationResult> {
  const counts = countDataset(localDataset);
  if (!hasMeaningfulData(localDataset)) {
    return { status: "empty", counts };
  }
  try {
    if (await cloudAccountHasData(client, userId)) {
      return { status: "conflict", counts, cloudAlreadyHasData: true };
    }
    // Upload the whole guest envelope. idempotent upsert + deleteMissing;
    // the local dataset is only ever READ here.
    const repository = new SupabaseRepository(client, userId);
    await repository.save(localDataset);
    return { status: "migrated", counts };
  } catch {
    return { status: "error", counts };
  }
}
