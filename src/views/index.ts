import type { RouteId } from "../ui/router";
import { renderDashboard } from "./dashboard";
import { renderHistory } from "./history";
import { renderMaintenance } from "./maintenance";
import { renderSettings } from "./settings";
import { renderVehicle } from "./vehicle";

/** A view may return a dispose function (e.g. to unsubscribe from the store). */
export type ViewRenderer = (container: HTMLElement) => (() => void) | void;

const views: Record<RouteId, ViewRenderer> = {
  dashboard: renderDashboard,
  maintenance: renderMaintenance,
  history: renderHistory,
  vehicle: renderVehicle,
  settings: renderSettings,
};

export function renderView(routeId: RouteId, container: HTMLElement): (() => void) | void {
  return views[routeId](container);
}