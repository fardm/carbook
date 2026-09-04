/**
 * Minimal hash-based router.
 *
 * URLs look like `#/dashboard`, `#/maintenance`, … which keeps the app
 * hostable on any static server (including GitHub Pages) with zero
 * server-side configuration.
 *
 * Detail hashes `#/maintenance/<itemId>` (§32) keep the "maintenance" route
 * so the bottom nav stays on نگهداری; the item id is read separately via
 * `maintenanceItemIdFromHash`.
 */

/** Matches `#/maintenance/<id>` (single path segment after the view). */
const MAINTENANCE_DETAIL_RE = /^\/maintenance\/([^/]+)$/;

export type RouteId = "dashboard" | "maintenance" | "history" | "vehicle" | "settings";

export interface RouteDef {
  id: RouteId;
  /** Hash fragment without the leading "#", e.g. "/dashboard". */
  hash: string;
  /** Lucide icon name for the navigation item. */
  icon: string;
}

export const routes: readonly RouteDef[] = [
  { id: "dashboard", hash: "/dashboard", icon: "layout-dashboard" },
  { id: "maintenance", hash: "/maintenance", icon: "wrench" },
  { id: "history", hash: "/history", icon: "history" },
  { id: "vehicle", hash: "/vehicle", icon: "car-front" },
  { id: "settings", hash: "/settings", icon: "settings" },
];

export const DEFAULT_ROUTE: RouteId = "dashboard";

/** Parses a location.hash value into a route id, falling back to the default. */
export function parseHash(hash: string): RouteId {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = routes.find((route) => route.hash === cleaned);
  if (match) return match.id;
  // Detail sub-hash of a view: same route (nav stays highlighted).
  if (MAINTENANCE_DETAIL_RE.test(cleaned)) return "maintenance";
  return DEFAULT_ROUTE;
}

/**
 * Extracts the item id from a maintenance detail hash like
 * `#/maintenance/<itemId>`; returns null for non-detail hashes.
 */
export function maintenanceItemIdFromHash(hash: string): string | null {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = MAINTENANCE_DETAIL_RE.exec(cleaned);
  return match ? decodeURIComponent(match[1]) : null;
}

export function routeFor(id: RouteId): RouteDef {
  const route = routes.find((r) => r.id === id);
  if (!route) throw new Error(`Unknown route: ${id}`);
  return route;
}

export function hashFor(id: RouteId): string {
  return `#${routeFor(id).hash}`;
}

/** The detail hash for an item: `#/maintenance/<itemId>`. */
export function maintenanceDetailHash(itemId: string): string {
  return `#/maintenance/${encodeURIComponent(itemId)}`;
}