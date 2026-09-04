import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTE,
  hashFor,
  maintenanceDetailHash,
  maintenanceItemIdFromHash,
  parseHash,
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

  it("exposes unique ids and hashes", () => {
    const ids = routes.map((r) => r.id);
    const hashes = routes.map((r) => r.hash);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("routeFor throws for unknown ids", () => {
    expect(() => routeFor("nope" as never)).toThrow();
  });
});