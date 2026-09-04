import { describe, expect, it } from "vitest";
import {
  buildItem,
  validateInitialInspection,
  validateInitialService,
  validateItemDraft,
  type ItemDraft,
} from "../src/domain/item-factory";

const NOW = "2026-09-04T10:00:00.000Z";

function draft(partial: Partial<ItemDraft> = {}): ItemDraft {
  return {
    name: "روغن موتور",
    category: "engine",
    icon: "droplets",
    intervalKm: 10000,
    intervalMonths: 6,
    inspectionBased: false,
    displayMode: "auto",
    ...partial,
  };
}

describe("validateItemDraft (§19)", () => {
  it("accepts a complete valid draft", () => {
    expect(validateItemDraft(draft())).toEqual([]);
  });

  it("requires a name", () => {
    expect(validateItemDraft(draft({ name: "  " }))).toContain("nameRequired");
  });

  it("requires positive integer intervals", () => {
    expect(validateItemDraft(draft({ intervalKm: 0 }))).toContain("kmInvalid");
    expect(validateItemDraft(draft({ intervalKm: 500.5 }))).toContain("kmInvalid");
    expect(validateItemDraft(draft({ intervalMonths: -1 }))).toContain("monthsInvalid");
  });

  it("requires at least one tracking rule", () => {
    const errors = validateItemDraft(
      draft({ intervalKm: null, intervalMonths: null, inspectionBased: false }),
    );
    expect(errors).toContain("ruleRequired");
  });

  it("accepts an inspection-only draft", () => {
    expect(validateItemDraft(draft({ intervalKm: null, intervalMonths: null, inspectionBased: true }))).toEqual([]);
  });
});

describe("buildItem", () => {
  it("builds an active item with the given id and catalogId", () => {
    const item = buildItem(draft(), { catalogId: "engineOil", now: NOW, id: "item-1" });
    expect(item.id).toBe("item-1");
    expect(item.catalogId).toBe("engineOil");
    expect(item.active).toBe(true);
    expect(item.rule.displayMode).toBe("auto");
    expect(item.createdAt).toBe(NOW);
  });

  it("persists a custom display mode (§26)", () => {
    const item = buildItem(draft({ displayMode: "time" }), { catalogId: null, now: NOW });
    expect(item.rule.displayMode).toBe("time");
  });

  it("trims the name", () => {
    const item = buildItem(draft({ name: "  روغن موتور  " }), { catalogId: null, now: NOW });
    expect(item.name).toBe("روغن موتور");
  });
});

describe("validateInitialService (§19)", () => {
  it("accepts empty initial data", () => {
    expect(validateInitialService({ date: "", odometer: null }, "2026-09-04")).toEqual([]);
  });

  it("accepts a valid date + odometer", () => {
    expect(validateInitialService({ date: "2026-08-20", odometer: 103900 }, "2026-09-04")).toEqual([]);
  });

  it("accepts a date without an odometer", () => {
    expect(validateInitialService({ date: "2026-08-20", odometer: null }, "2026-09-04")).toEqual([]);
  });

  it("rejects an odometer without a date", () => {
    expect(validateInitialService({ date: "", odometer: 103900 }, "2026-09-04")).toContain("missingDate");
  });

  it("rejects future or malformed dates", () => {
    expect(validateInitialService({ date: "2026-09-05", odometer: null }, "2026-09-04")).toContain("futureDate");
    expect(validateInitialService({ date: "2026-13-45", odometer: null }, "2026-09-04")).toContain("invalidDate");
  });

  it("rejects negative or non-integer odometers", () => {
    expect(validateInitialService({ date: "2026-08-20", odometer: -1 }, "2026-09-04")).toContain("invalidOdometer");
    expect(validateInitialService({ date: "2026-08-20", odometer: 104.5 }, "2026-09-04")).toContain("invalidOdometer");
  });
});

describe("validateInitialInspection (§19, §36)", () => {
  it("accepts empty initial data", () => {
    expect(validateInitialInspection({ date: "", condition: null }, "2026-09-04")).toEqual([]);
  });

  it("accepts a date with or without a condition", () => {
    expect(validateInitialInspection({ date: "2026-08-20", condition: "good" }, "2026-09-04")).toEqual([]);
    expect(validateInitialInspection({ date: "2026-08-20", condition: null }, "2026-09-04")).toEqual([]);
  });

  it("rejects a condition without a date", () => {
    expect(validateInitialInspection({ date: "", condition: "watch" }, "2026-09-04")).toContain("missingDate");
  });

  it("rejects future dates", () => {
    expect(validateInitialInspection({ date: "2026-09-05", condition: null }, "2026-09-04")).toContain("futureDate");
  });
});