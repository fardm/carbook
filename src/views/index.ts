import type { RouteId } from "../ui/router";
import { leaveAccountView, renderAccount } from "./account";
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
  account: renderAccount,
};

export function renderView(routeId: RouteId, container: HTMLElement): (() => void) | void {
  // Leaving the Account page resets its view-local form/offer state; module
  // state must never leak into the next visit. The page's one-time guest→
  // cloud migration offer survives navigation on purpose (see views/account.ts).
  if (routeId !== "account") leaveAccountView();
  return views[routeId](container);
}