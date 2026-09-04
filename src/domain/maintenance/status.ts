import { addMonths } from "./dates";
import type { InspectionRecord, MaintenanceItem, StatusThresholds } from "../types";

/**
 * Maintenance status (§29). Values are language-independent ids; the UI maps
 * them to localized labels/icons (§29 requires text + icon, never color only).
 *
 * Interval items (percent-based, §28):
 *   OVERDUE    remaining < 0 (past the due point)
 *   DUE        0% ≤ remaining ≤ duePercent
 *   DUE_SOON   duePercent < remaining ≤ dueSoonPercent
 *   UPCOMING   dueSoonPercent < remaining < 100%
 *   OK         remaining ≥ 100% (freshly serviced / full life ahead)
 *
 * Inspection items (§16, §28): no fabricated remaining life.
 *   INSPECTION_REQUIRED  no inspection yet, or the configured inspection
 *                        interval has been exceeded
 *   DUE / DUE_SOON / UPCOMING / OK  mapped from the last recorded condition
 *                        (replaceNow / replaceSoon / watch / good)
 */
export type MaintenanceStatus =
  | "ok"
  | "upcoming"
  | "dueSoon"
  | "due"
  | "overdue"
  | "inspectionRequired";

export interface StatusRemaining {
  remainingKm: number | null;
  remainingDays: number | null;
  remainingPercent: number | null;
}

export interface StatusContext {
  /** "yyyy-mm-dd" reference date. */
  today: string;
  currentOdometer: number | null;
  lastInspection: InspectionRecord | null;
  thresholds: StatusThresholds;
}

export function calculateMaintenanceStatus(
  item: MaintenanceItem,
  remaining: StatusRemaining,
  ctx: StatusContext,
): MaintenanceStatus {
  if (item.rule.inspectionBased) return inspectionStatus(item, remaining, ctx);
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

function inspectionStatus(
  item: MaintenanceItem,
  _remaining: StatusRemaining,
  ctx: StatusContext,
): MaintenanceStatus {
  const { lastInspection, today, currentOdometer } = ctx;
  if (!lastInspection) return "inspectionRequired";

  // Configured inspection interval exceeded → inspection is required (§16).
  const kmInterval = item.rule.intervalKm;
  if (kmInterval != null && lastInspection.odometer != null && currentOdometer != null) {
    if (currentOdometer >= lastInspection.odometer + kmInterval) return "inspectionRequired";
  }
  const monthInterval = item.rule.intervalMonths;
  if (monthInterval != null) {
    const due = addMonths(lastInspection.date, monthInterval);
    if (due < today) return "inspectionRequired"; // ISO strings compare lexicographically
  }

  switch (lastInspection.condition) {
    case "replaceNow":
      return "due";
    case "replaceSoon":
      return "dueSoon";
    case "watch":
      return "upcoming";
    default:
      return "ok";
  }
}