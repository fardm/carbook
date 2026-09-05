import { describe, expect, it } from "vitest";
import { CATALOG, CATEGORIES, catalogEntry, categoryName, isCatalogCategoryId } from "../src/catalog";
import {
  customItemFromInput,
  itemFromCatalog,
  validateCustomItem,
  type CustomItemInput,
} from "../src/domain/item-factory";
import type { MaintenanceItem } from "../src/domain/types";

const NOW = "2026-09-04T10:00:00.000Z";

describe("catalog integrity (§12, §13, §20)", () => {
  it("has unique language-independent ids", () => {
    const ids = CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has non-empty localized names for every entry", () => {
    for (const entry of CATALOG) {
      expect(entry.name.fa.trim(), `${entry.id}.fa`).not.toBe("");
      expect(entry.name.en.trim(), `${entry.id}.en`).not.toBe("");
    }
  });

  it("uses valid categories and known lucide icon names", () => {
    const categoryIds = new Set(CATEGORIES.map((category) => category.id));
    for (const entry of CATALOG) {
      expect(categoryIds.has(entry.category), `${entry.id} category`).toBe(true);
      expect(entry.icon.trim(), `${entry.id} icon`).not.toBe("");
    }
  });

  it("keeps suggested values inside their recommended ranges", () => {
    for (const entry of CATALOG) {
      if (entry.suggestedKm != null) {
        expect(entry.kmRange, `${entry.id} kmRange`).not.toBeNull();
        expect(entry.suggestedKm).toBeGreaterThanOrEqual(entry.kmRange![0]);
        expect(entry.suggestedKm).toBeLessThanOrEqual(entry.kmRange![1]);
      }
      if (entry.suggestedMonths != null) {
        expect(entry.monthsRange, `${entry.id} monthsRange`).not.toBeNull();
        expect(entry.suggestedMonths).toBeGreaterThanOrEqual(entry.monthsRange![0]);
        expect(entry.suggestedMonths).toBeLessThanOrEqual(entry.monthsRange![1]);
      }
    }
  });

  it("provides the §20 examples", () => {
    expect(catalogEntry("engineOil")?.suggestedKm).toBe(10000);
    expect(catalogEntry("engineOil")?.kmRange).toEqual([8000, 12000]);
    expect(catalogEntry("cabinFilter")?.suggestedKm).toBe(15000);
    expect(catalogEntry("cabinFilter")?.kmRange).toEqual([10000, 20000]);
    expect(catalogEntry("brakeFluid")?.suggestedMonths).toBe(24);
    expect(catalogEntry("tires")?.suggestedMonths).toBe(60);
  });

  it("categoryName resolves every category; unknown ids are rejected", () => {
    for (const category of CATEGORIES) {
      expect(categoryName(category.id)).toBe(category.name.fa);
      expect(isCatalogCategoryId(category.id)).toBe(true);
    }
    expect(isCatalogCategoryId("nope")).toBe(false);
  });
});

describe("item factories (§14, §37)", () => {
  it("itemFromCatalog activates a template with its recommended rule", () => {
    const entry = catalogEntry("engineOil")!;
    const item = itemFromCatalog(entry, NOW);
    expect(item.catalogId).toBe("engineOil");
    expect(item.name).toBe("روغن موتور");
    expect(item.category).toBe("engine");
    expect(item.icon).toBe("droplets");
    expect(item.rule).toEqual({
      intervalKm: 10000,
      intervalMonths: 6,
      trigger: "any",
      displayMode: "auto",
    });
    expect(item.active).toBe(true);
    expect(item.createdAt).toBe(NOW);
  });

  it("itemFromCatalog preserves the catalog interval", () => {
    const item = itemFromCatalog(catalogEntry("brakePadsFront")!, NOW);
    expect(item.rule.intervalKm).toBe(10000);
    expect(item.rule.intervalMonths).toBe(6);
  });

  it("customItemFromInput produces an item with catalogId null", () => {
    const input: CustomItemInput = {
      name: "تسمه دینام",
      category: "engine",
      icon: "wrench",
      intervalKm: 50000,
      intervalMonths: null,
    };
    const item: MaintenanceItem = customItemFromInput(input, NOW);
    expect(item.catalogId).toBeNull();
    expect(item.name).toBe("تسمه دینام");
    expect(item.rule.intervalKm).toBe(50000);
  });

  it("validateCustomItem requires a name", () => {
    expect(validateCustomItem({ ...validCustom(), name: "  " })).toContain("nameRequired");
  });

  it("validateCustomItem requires positive integer intervals", () => {
    expect(validateCustomItem({ ...validCustom(), intervalKm: -5 })).toContain("kmInvalid");
    expect(validateCustomItem({ ...validCustom(), intervalKm: 100.5 })).toContain("kmInvalid");
    expect(validateCustomItem({ ...validCustom(), intervalMonths: 0 })).toContain("monthsInvalid");
  });

  it("validateCustomItem requires a tracking rule (§37)", () => {
    expect(validateCustomItem({ ...validCustom(), intervalKm: null, intervalMonths: null })).toContain("ruleRequired");
  });
});

function validCustom(): CustomItemInput {
  return {
    name: "مورد سفارشی",
    category: "other",
    icon: "wrench",
    intervalKm: 10000,
    intervalMonths: 6,
  };
}