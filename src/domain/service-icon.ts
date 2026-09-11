import { catalogEntry } from "../catalog/catalog";
import type { MaintenanceItem } from "./types";

/**
 * Canonical icon resolution for service instances.
 *
 * - Catalog-linked items (catalogId != null) are developer-owned metadata:
 *   the displayed icon always resolves from the current catalog definition,
 *   so a developer-side icon change propagates to existing users without
 *   touching their stored service data (history, mileage, dates, …).
 * - Custom items (catalogId == null) are user-owned: the stored icon is used.
 * - Unknown/deleted catalog ids fall back to the stored icon so nothing
 *   ever renders blank and no user data is lost.
 */
export function canonicalIconForCatalogId(catalogId: string | null | undefined): string | null {
  if (catalogId == null) return null;
  return catalogEntry(catalogId)?.icon ?? null;
}

export function resolveServiceIcon(
  item: Pick<MaintenanceItem, "catalogId" | "icon">,
): string {
  const canonical = canonicalIconForCatalogId(item.catalogId);
  return canonical ?? item.icon;
}

/**
 * Returns the icon that should be PERSISTED for an item.
 * Catalog-linked items persist the canonical icon (keeps stored rows
 * converged without duplicating stale metadata); custom items keep the
 * user-chosen icon.
 */
export function persistedIconForItem(
  item: Pick<MaintenanceItem, "catalogId" | "icon">,
): string {
  return resolveServiceIcon(item);
}
