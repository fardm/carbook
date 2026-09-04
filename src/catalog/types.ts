import type { DisplayMode } from "../domain/types";

/**
 * Maintenance catalog types (PROJECT_PLAN §7, §12–§13, §20).
 *
 * Catalog entries are TEMPLATES, not active items (§14). IDs are
 * language-independent; names are localized via `{ fa, en }` (§7).
 * Intervals are general recommendations — the UI must label them as such
 * (§13) and users can always customize them.
 */

export type CatalogCategoryId =
  | "engine"
  | "fluids"
  | "brakes"
  | "tiresWheels"
  | "electrical"
  | "filters"
  | "other";

export interface LocalizedName {
  fa: string;
  en: string;
}

export interface CatalogCategory {
  id: CatalogCategoryId;
  name: LocalizedName;
}

/** A predefined maintenance template (§13). */
export interface CatalogEntry {
  /** Language-independent id, e.g. "engineOil". */
  id: string;
  category: CatalogCategoryId;
  /** Lucide icon name (kebab-case). */
  icon: string;
  name: LocalizedName;
  /** Suggested km interval — becomes the default intervalKm when activated. */
  suggestedKm: number | null;
  /** Reasonable km range for display: [min, max]. */
  kmRange: [number, number] | null;
  /** Suggested months interval — default intervalMonths when activated. */
  suggestedMonths: number | null;
  /** Reasonable months range for display. */
  monthsRange: [number, number] | null;
  /** Inspection-based templates track condition, not fabricated life (§16). */
  inspectionBased: boolean;
  /** Default display preference (§26); "auto" unless stated otherwise. */
  displayMode?: DisplayMode;
}