import type { RouteId } from "../ui/router";
import { renderReminders } from "./reminders";
import { renderServices } from "./services";
import { renderSettings } from "./settings";
import { renderVehicle } from "./vehicle";

/** A view may return a dispose function (e.g. to unsubscribe from the store). */
export type ViewRenderer = (container: HTMLElement) => (() => void) | void;

const views: Record<RouteId, ViewRenderer> = {
  maintenance: renderServices,
  vehicle: renderVehicle,
  reminders: renderReminders,
  settings: renderSettings,
};

export function renderView(routeId: RouteId, container: HTMLElement): (() => void) | void {
  return views[routeId](container);
}