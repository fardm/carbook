import type { CatalogCategory, CatalogCategoryId } from "./types";

/** Catalog categories with localized names (§12). */
export const CATEGORIES: readonly CatalogCategory[] = [
  { id: "engine", name: { fa: "موتور", en: "Engine" } },
  { id: "fluids", name: { fa: "سیالات", en: "Fluids" } },
  { id: "brakes", name: { fa: "ترمز", en: "Brakes" } },
  { id: "tiresWheels", name: { fa: "لاستیک و چرخ", en: "Tires & Wheels" } },
  { id: "electrical", name: { fa: "برق و روشنایی", en: "Electrical" } },
  { id: "filters", name: { fa: "فیلترها", en: "Filters" } },
  { id: "other", name: { fa: "سایر", en: "Other" } },
];

const categoryById = new Map(CATEGORIES.map((category) => [category.id, category]));

export function categoryName(categoryId: string, locale: "fa" | "en" = "fa"): string {
  return categoryById.get(categoryId as CatalogCategoryId)?.name[locale] ?? categoryId;
}

export function isCatalogCategoryId(value: string): value is CatalogCategoryId {
  return categoryById.has(value as CatalogCategoryId);
}