import type { MaintenanceCalculation, MaintenanceStatus } from "../domain/maintenance";
import type { DisplayMode } from "../domain/types";
import { t } from "../i18n";
import { faNum, formatDate } from "./format";

/**
 * Presentation layer for maintenance calculations (§26–§27, §31).
 *
 * Everything here derives STRINGS from the calculation engine's result — no
 * calculation is duplicated in the UI (§48). Remaining km/days/percent come
 * straight from `calculateMaintenance`.
 */

export type PrimaryMetricKind = "km" | "days" | "none";

/**
 * Resolves the primary metric to show (§26): Auto follows the engine's
 * primary criterion; explicit modes fall back to the other criterion when
 * their own is unavailable; inspection items have no metric.
 */
export function resolvePrimaryMetric(
  calc: MaintenanceCalculation,
  displayMode: DisplayMode,
): PrimaryMetricKind {
  if (calc.remainingKm == null && calc.remainingDays == null) return "none";
  if (displayMode === "km") return calc.remainingKm != null ? "km" : "days";
  if (displayMode === "time") return calc.remainingDays != null ? "days" : "km";
  // auto + both: the criterion expected to trigger first (§25)
  return calc.primaryCriterion === "km" ? "km" : "days";
}

/** "۷٬۵۰۰ کیلومتر باقیمانده" / "۱۲ روز گذشته" — the actionable primary value. */
export function primaryMetricText(calc: MaintenanceCalculation, kind: PrimaryMetricKind): string | null {
  if (kind === "km" && calc.remainingKm != null) {
    return `${faNum(Math.abs(calc.remainingKm))} ${t("common.kmUnit")} ${
      calc.remainingKm >= 0 ? t("maintenance.list.remaining") : t("maintenance.list.past")
    }`;
  }
  if (kind === "days" && calc.remainingDays != null) {
    return `${faNum(Math.abs(calc.remainingDays))} ${t("maintenance.list.daysUnit")} ${
      calc.remainingDays >= 0 ? t("maintenance.list.remaining") : t("maintenance.list.past")
    }`;
  }
  return null;
}

/** Secondary line: estimated time for km-primary, percentage for time-primary. */
export function secondaryMetricText(calc: MaintenanceCalculation, kind: PrimaryMetricKind): string | null {
  if (kind === "km" && calc.estimatedKmDays != null) {
    // The estimate comes from average daily distance (§24) — always "~".
    return `~${formatRemainingTime(calc.estimatedKmDays)}`;
  }
  if (kind === "days" && calc.remainingPercent != null) {
    return `${faNum(Math.round(calc.remainingPercent))}٪ ${t("maintenance.list.remaining")}`;
  }
  return null;
}

/** "سررسید: ۱۸ شهریور" (time) / "تخمین: ۱۸ شهریور" (km) — §24/§31. */
export function dueDateText(calc: MaintenanceCalculation, kind: PrimaryMetricKind): string | null {
  if (!calc.estimatedDueDate) return null;
  const date = formatDate(calc.estimatedDueDate);
  return kind === "km"
    ? `${t("maintenance.list.estimateDate")}: ${date}`
    : `${t("maintenance.list.dueDate")}: ${date}`;
}

/** Days → "۱۲ روز" or "۴ ماه" for large values (§23). */
export function formatRemainingTime(days: number): string {
  const absolute = Math.abs(days);
  if (absolute >= 90) {
    return `${faNum(Math.round(absolute / 30.44))} ${t("maintenance.monthsUnit")}`;
  }
  return `${faNum(days)} ${t("maintenance.list.daysUnit")}`;
}

const STATUS_KEYS: Record<MaintenanceStatus, string> = {
  ok: "status.ok",
  upcoming: "status.upcoming",
  dueSoon: "status.dueSoon",
  due: "status.due",
  overdue: "status.overdue",
  inspectionRequired: "status.inspectionRequired",
};

export function statusLabel(status: MaintenanceStatus): string {
  return t(STATUS_KEYS[status] as never);
}

export type HealthBand = "high" | "mid" | "low";

/**
 * Three-band health color classification driven by the PERCENTAGE itself
 * (green / orange / red), reusing the engine's configured status thresholds
 * (§28–§29) — no new or duplicate numbers:
 *   at/below duePercent   → low (red)   — also covers negative/overdue
 *   at/below dueSoonPercent → mid (orange)
 *   otherwise             → high (green)
 * Chart fills and the percentage text must be colored from the SAME rounded
 * value so the two always match.
 */
export function healthBand(percent: number, thresholds: { duePercent: number; dueSoonPercent: number }): HealthBand {
  if (percent <= thresholds.duePercent) return "low";
  if (percent <= thresholds.dueSoonPercent) return "mid";
  return "high";
}

/** Urgency ordering: overdue first … ok last (§30 sorting). */
export function urgencyRank(status: MaintenanceStatus): number {
  switch (status) {
    case "overdue":
      return 0;
    case "due":
      return 1;
    case "dueSoon":
    case "inspectionRequired":
      return 2;
    case "upcoming":
      return 3;
    case "ok":
      return 4;
  }
}

/**
 * Sorts items by urgency (status rank, then remaining % ascending —
 * inspection items with no % sort last within their rank).
 */
export function compareByUrgency(
  a: { status: MaintenanceStatus; remainingPercent: number | null },
  b: { status: MaintenanceStatus; remainingPercent: number | null },
): number {
  const rankDiff = urgencyRank(a.status) - urgencyRank(b.status);
  if (rankDiff !== 0) return rankDiff;
  const aPercent = a.remainingPercent ?? Number.POSITIVE_INFINITY;
  const bPercent = b.remainingPercent ?? Number.POSITIVE_INFINITY;
  return aPercent - bPercent;
}

/** Summary buckets for the dashboard (§30): overdue / due soon / ok. */
export function summaryBucket(status: MaintenanceStatus): "overdue" | "dueSoon" | "ok" {
  if (status === "overdue") return "overdue";
  if (status === "due" || status === "dueSoon" || status === "inspectionRequired") return "dueSoon";
  return "ok";
}