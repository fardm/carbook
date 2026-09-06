/**
 * Minimal hash-based router.
 *
 * URLs look like `#/vehicle`, `#/services`, … which keeps the app hostable
 * on any static server (including GitHub Pages) with zero server-side
 * configuration.
 *
 * - Detail hashes `#/maintenance/<itemId>` keep the "maintenance" route so
 *   the bottom nav stays on سرویس ها; the item id is read separately via
 *   `maintenanceItemIdFromHash`.
 * - The services page accepts `#/maintenance?vehicle=<id>` to pre-select a
 *   vehicle (used by سرویس ها buttons on vehicle cards); read via
 *   `servicesVehicleIdFromHash`.
 *
 * Note: the hash path for the services page stays "/maintenance" (historic
 * route id) so old detail links keep working; only the visible label and
 * page title are "سرویس ها".
 */

/** Matches `#/maintenance/<id>` (single path segment after the view). */
const MAINTENANCE_DETAIL_RE = /^\/maintenance\/([^/]+)$/;

export type RouteId = "maintenance" | "vehicle" | "reminders" | "settings";

export interface RouteDef {
  id: RouteId;
  /** Hash fragment without the leading "#", e.g. "/vehicle". */
  hash: string;
  /** Lucide icon name for the navigation item. */
  icon: string;
}

export const routes: readonly RouteDef[] = [
  { id: "vehicle", hash: "/vehicle", icon: "car-front" },
  { id: "maintenance", hash: "/maintenance", icon: "wrench" },
  { id: "reminders", hash: "/reminders", icon: "bell" },
  { id: "settings", hash: "/settings", icon: "settings" },
];

/** The Vehicles page is the first/default page after login. */
export const DEFAULT_ROUTE: RouteId = "vehicle";

/** The path portion of a hash (query string stripped), e.g. "/maintenance". */
function pathOf(hash: string): string {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  return cleaned.split("?")[0];
}

/** Parses a location.hash value into a route id, falling back to the default. */
export function parseHash(hash: string): RouteId {
  const path = pathOf(hash);
  const match = routes.find((route) => route.hash === path);
  if (match) return match.id;
  // Detail sub-hash of a view: same route (nav stays highlighted).
  if (MAINTENANCE_DETAIL_RE.test(path)) return "maintenance";
  return DEFAULT_ROUTE;
}

/**
 * Extracts the item id from a maintenance detail hash like
 * `#/maintenance/<itemId>`; returns null for non-detail hashes.
 */
export function maintenanceItemIdFromHash(hash: string): string | null {
  const match = MAINTENANCE_DETAIL_RE.exec(pathOf(hash));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Extracts the vehicle id from `#/maintenance?vehicle=<id>`; null when the
 * hash is not a services-page hash with a vehicle param.
 */
export function servicesVehicleIdFromHash(hash: string): string | null {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, query] = cleaned.split("?");
  if (path !== "/maintenance") return null;
  const id = query != null ? new URLSearchParams(query).get("vehicle") : null;
  return id ? decodeURIComponent(id) : null;
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

/**
 * Extracts reminder creation params from `#/reminders?serviceId=<id>&vehicle=<id>`.
 */
export function remindersCreateParamsFromHash(hash: string): { serviceId: string, vehicleId: string } | null {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, query] = cleaned.split("?");
  if (path !== "/reminders") return null;
  const s = query != null ? new URLSearchParams(query).get("serviceId") : null;
  const v = query != null ? new URLSearchParams(query).get("vehicle") : null;
  if (s && v) return { serviceId: decodeURIComponent(s), vehicleId: decodeURIComponent(v) };
  return null;
}
