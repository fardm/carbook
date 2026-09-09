import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTE,
  hashFor,
  maintenanceDetailHash,
  maintenanceItemIdFromHash,
  parseHash,
  remindersEditIdFromHash,
  navRoutes,
  remindersFocusIdFromHash,
  remindersHash,
  remindersServiceIdFromHash,
  routeFor,
  routes,
} from "../src/ui/router";

describe("router", () => {
  it("parses every defined route with and without the leading #", () => {
    for (const route of routes) {
      expect(parseHash(`#${route.hash}`)).toBe(route.id);
      expect(parseHash(route.hash)).toBe(route.id);
    }
  });

  it("falls back to the default route for empty or unknown hashes", () => {
    expect(parseHash("")).toBe(DEFAULT_ROUTE);
    expect(parseHash("#")).toBe(DEFAULT_ROUTE);
    expect(parseHash("#/nope")).toBe(DEFAULT_ROUTE);
    expect(parseHash("garbage")).toBe(DEFAULT_ROUTE);
  });

  it("round-trips route ids through hashFor/parseHash", () => {
    for (const route of routes) {
      expect(parseHash(hashFor(route.id))).toBe(route.id);
    }
  });

  it("keeps the maintenance route for detail hashes but extracts the item id", () => {
    const hash = maintenanceDetailHash("item-123");
    expect(parseHash(hash)).toBe("maintenance");
    expect(maintenanceItemIdFromHash(hash)).toBe("item-123");
    expect(maintenanceItemIdFromHash("#/maintenance/")).toBe(null);
    expect(maintenanceItemIdFromHash("#/maintenance")).toBe(null);
    expect(maintenanceItemIdFromHash("#/dashboard")).toBe(null);
  });

  it("keeps the Account page routable but out of the bottom navigation", () => {
    const account = routes.find((r) => r.id === "account");
    expect(account).toBeDefined();
    expect(parseHash("#/account")).toBe("account");
    expect(parseHash("/account")).toBe("account");
    // Real route (deep-linkable, refresh-safe) but never a nav link.
    expect(navRoutes.map((r) => r.id)).not.toContain("account");
    expect(navRoutes).toHaveLength(routes.length - 1);
  });

  it("exposes unique ids and hashes", () => {
    const ids = routes.map((r) => r.id);
    const hashes = routes.map((r) => r.hash);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("routeFor throws for unknown ids", () => {
    expect(() => routeFor("nope" as never)).toThrow();
  });

  it("remindersHash builds params and the readers round-trip them", () => {
    expect(remindersHash({})).toBe("#/reminders");
    expect(remindersHash({ vehicle: "v1" })).toBe("#/reminders?vehicle=v1");
    expect(remindersHash({ service: "item-1" })).toBe("#/reminders?service=item-1");
    expect(remindersHash({ edit: "rem-9" })).toBe("#/reminders?edit=rem-9");
    const focus = remindersHash({ focus: "rem-9" });
    expect(focus).toBe("#/reminders?focus=rem-9");
    expect(remindersFocusIdFromHash(focus)).toBe("rem-9");
    expect(remindersServiceIdFromHash("#/reminders?service=item-1")).toBe("item-1");
    expect(remindersEditIdFromHash("#/reminders?edit=rem-9")).toBe("rem-9");
    // Readers only match the reminders page.
    expect(remindersFocusIdFromHash("#/maintenance?focus=rem-9")).toBe(null);
    expect(remindersFocusIdFromHash("#/reminders")).toBe(null);
  });
});