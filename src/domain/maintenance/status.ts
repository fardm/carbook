import type { MaintenanceItem, StatusThresholds } from "../types";

/**
 * Maintenance status (§29). Values are language-independent ids; the UI maps
 * them to localized labels/icons (§29 requires text + icon, never color only).
 *
 * Every item is tracked the same way (percent-based, §28):
 *   OVERDUE    remaining < 0 (past the due point)
 *   DUE        0% ≤ remaining ≤ duePercent
 *   DUE_SOON   duePercent < remaining ≤ dueSoonPercent
 *   UPCOMING   dueSoonPercent < remaining < 100%
 *   OK         remaining ≥ 100% (freshly serviced / full life ahead)
 */
export type MaintenanceStatus =
  | "ok"
  | "upcoming"
  | "dueSoon"
  | "due"
  | "overdue";

export interface StatusRemaining {
  remainingKm: number | null;
  remainingDays: number | null;
  remainingPercent: number | null;
}

export interface StatusContext {
  /** "yyyy-mm-dd" reference date. */
  today: string;
  currentOdometer: number | null;
  thresholds: StatusThresholds;
}

export function calculateMaintenanceStatus(
  _item: MaintenanceItem,
  remaining: StatusRemaining,
  ctx: StatusContext,
): MaintenanceStatus {
  return intervalStatus(remaining, ctx.thresholds);
}

function intervalStatus(remaining: StatusRemaining, thresholds: StatusThresholds): MaintenanceStatus {
  if (remaining.remainingPercent == null) return "ok";
  if (remaining.remainingKm != null && remaining.remainingKm < 0) return "overdue";
  if (remaining.remainingDays != null && remaining.remainingDays < 0) return "overdue";
  const percent = remaining.remainingPercent;
  if (percent <= thresholds.duePercent) return "due";
  if (percent <= thresholds.dueSoonPercent) return "dueSoon";
  if (percent < 100) return "upcoming";
  return "ok";
}