import type { CatalogEntry, CatalogCategoryId } from "../catalog";
import { createId } from "./ids";
import { isIsoDate } from "./odometer";
import type { DisplayMode, MaintenanceItem } from "./types";

/**
 * Factories turning user configuration into ACTIVE maintenance items
 * (§14: template → user configuration → active item; §19). Catalog and
 * custom items share one build path and one calculation engine (§37).
 */

/** The editable configuration of a maintenance item (§19, §26). */
export interface ItemDraft {
  name: string;
  category: CatalogCategoryId;
  icon: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  displayMode: DisplayMode;
}

export type ItemDraftError = "nameRequired" | "kmInvalid" | "monthsInvalid" | "ruleRequired";

export type CustomItemError = ItemDraftError;

/** Builds an active item from user configuration. The item is linked to its
 * owning vehicle via `opts.vehicleId` (null = unassigned). */
export function buildItem(
  draft: ItemDraft,
  opts: { catalogId: string | null; now: string; id?: string; vehicleId?: string | null },
): MaintenanceItem {
  return {
    id: opts.id ?? createId(),
    vehicleId: opts.vehicleId ?? null,
    catalogId: opts.catalogId,
    name: draft.name.trim(),
    category: draft.category,
    icon: draft.icon,
    rule: {
      intervalKm: draft.intervalKm,
      intervalMonths: draft.intervalMonths,
      trigger: "any",
      displayMode: draft.displayMode,
    },
    active: true,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/** Activates a catalog template with its recommended (suggested) rule. */
export function itemFromCatalog(entry: CatalogEntry, now: string): MaintenanceItem {
  return buildItem(
    {
      name: entry.name.fa, // localized snapshot; catalogId allows re-resolving
      category: entry.category,
      icon: entry.icon,
      intervalKm: entry.suggestedKm,
      intervalMonths: entry.suggestedMonths,
      displayMode: entry.displayMode ?? "auto",
    },
    { catalogId: entry.id, now },
  );
}

export interface CustomItemInput {
  name: string;
  category: CatalogCategoryId;
  icon: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  displayMode?: DisplayMode;
}

/** Creates a custom item (§37). */
export function customItemFromInput(input: CustomItemInput, now: string): MaintenanceItem {
  return buildItem(
    { ...input, displayMode: input.displayMode ?? "auto" },
    { catalogId: null, now },
  );
}

/**
 * Validation: name required; intervals must be positive integers; a tracking
 * rule is required (at least one interval).
 */
export function validateItemDraft(draft: ItemDraft): ItemDraftError[] {
  const errors: ItemDraftError[] = [];
  if (draft.name.trim() === "") errors.push("nameRequired");
  if (draft.intervalKm != null && (!Number.isInteger(draft.intervalKm) || draft.intervalKm <= 0)) {
    errors.push("kmInvalid");
  }
  if (
    draft.intervalMonths != null &&
    (!Number.isInteger(draft.intervalMonths) || draft.intervalMonths <= 0)
  ) {
    errors.push("monthsInvalid");
  }
  if (draft.intervalKm == null && draft.intervalMonths == null) errors.push("ruleRequired");
  return errors;
}

export function validateCustomItem(input: CustomItemInput): CustomItemError[] {
  return validateItemDraft({ ...input, displayMode: input.displayMode ?? "auto" });
}

/** Errors for optional initial service data (§19). */
export type InitialDataError = "missingDate" | "invalidDate" | "futureDate" | "invalidOdometer";

/**
 * Validates the optional initial SERVICE data. A record is created only when
 * a date is provided; an odometer without a date is rejected.
 */
export function validateInitialService(
  entry: { date: string; odometer: number | null },
  today: string,
): InitialDataError[] {
  const errors: InitialDataError[] = [];
  if (entry.date === "" && entry.odometer != null) {
    errors.push("missingDate");
  } else if (entry.date !== "") {
    if (!isIsoDate(entry.date)) errors.push("invalidDate");
    else if (entry.date > today) errors.push("futureDate");
  }
  if (entry.odometer != null && (!Number.isInteger(entry.odometer) || entry.odometer < 0)) {
    errors.push("invalidOdometer");
  }
  return errors;
}
