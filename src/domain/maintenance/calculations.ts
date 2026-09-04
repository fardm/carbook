import { lastInspectionFor, lastServiceFor } from "../baselines";
import type {
  InspectionRecord,
  MaintenanceItem,
  ServiceRecord,
  Settings,
  Vehicle,
} from "../types";
import { dayToIso, isoToDay, todayIso } from "./dates";
import { nextDueDate, nextDueOdometer, totalIntervalDays } from "./rules";
import {
  calculateMaintenanceStatus,
  type MaintenanceStatus,
} from "./status";

/** Criterion types that can drive a maintenance rule (§16). */
export type Criterion = "km" | "time";

/** Everything the calculation needs for ONE vehicle (multi-vehicle: each
 * item is computed against its own vehicle's facts). */
export interface CalculationContext {
  /** The item's vehicle facts; null for legacy unassigned items / no vehicle. */
  vehicle: { averageDailyDistance: number | null; currentOdometer: number | null } | null;
  serviceHistory: readonly ServiceRecord[];
  inspectionHistory: readonly InspectionRecord[];
  settings: Pick<Settings, "statusThresholds">;
}

/**
 * Builds the calculation context for a dataset + vehicle id. History is NOT
 * filtered here — the engine looks records up by the item's id, and item ids
 * are globally unique, so cross-vehicle sharing is impossible.
 */
export function contextForVehicle(
  dataset: {
    vehicles: readonly Vehicle[];
    serviceHistory: readonly ServiceRecord[];
    inspectionHistory: readonly InspectionRecord[];
    settings: Pick<Settings, "statusThresholds">;
  },
  vehicleId: string | null,
): CalculationContext {
  const vehicle = vehicleId == null ? null : dataset.vehicles.find((v) => v.id === vehicleId) ?? null;
  return {
    vehicle: vehicle
      ? {
          averageDailyDistance: vehicle.averageDailyDistance,
          currentOdometer: vehicle.currentOdometer,
        }
      : null,
    serviceHistory: dataset.serviceHistory,
    inspectionHistory: dataset.inspectionHistory,
    settings: dataset.settings,
  };
}

/**
 * Result of calculating one maintenance item (§48). All fields are derived —
 * never persisted (§4).
 */
export interface MaintenanceCalculation {
  status: MaintenanceStatus;
  /** Remaining km (§22); null when not computable (no baseline/odometer). */
  remainingKm: number | null;
  /** Remaining calendar days for the time criterion (§23). */
  remainingDays: number | null;
  /** Estimated days until the km criterion triggers, from average daily
   * distance (§24); null when not estimable (no average distance). */
  estimatedKmDays: number | null;
  /** Estimated due date (ISO) of the PRIMARY criterion (§24). Estimate only. */
  estimatedDueDate: string | null;
  /** Remaining % of configured life for the primary criterion, clamped
   * 0–100 (§28); null when there is nothing to measure. */
  remainingPercent: number | null;
  /** The criterion expected to trigger first (§25). */
  primaryCriterion: Criterion | null;
  /** lastServiceOdometer + intervalKm (§22). */
  nextDueOdometer: number | null;
  /** lastServiceDate + intervalMonths (§23). */
  nextDueDate: string | null;
  /** Calendar days in the configured time interval. */
  totalIntervalDays: number | null;
  /** Baseline facts for the detail-page explanation (§33). */
  lastService: { date: string; odometer: number | null } | null;
}

/**
 * Central calculation entry point (§21). Computes every derived value for one
 * item. `today` is injectable for deterministic tests.
 */
export function calculateMaintenance(
  item: MaintenanceItem,
  ctx: CalculationContext,
  today: string = todayIso(),
): MaintenanceCalculation {
  const lastService = lastServiceFor(ctx.serviceHistory, item.id);
  const dueOdometer = nextDueOdometer(lastService, item.rule.intervalKm);
  const dueDate = nextDueDate(lastService, item.rule.intervalMonths);
  const currentOdometer = ctx.vehicle?.currentOdometer ?? null;

  const remainingKm = calculateRemainingKm(dueOdometer, currentOdometer);
  const remainingDays = calculateRemainingDays(dueDate, today);
  const intervalDays = totalIntervalDays(lastService?.date ?? null, dueDate);

  const averageDaily = ctx.vehicle?.averageDailyDistance ?? null;
  const estimatedKmDays = calculateEstimatedKmDays(remainingKm, averageDaily);

  const primaryCriterion = determinePrimaryTrigger(item.rule, {
    remainingKm,
    remainingDays,
    estimatedKmDays,
  });

  const estimatedDueDate = calculateEstimatedDueDate(
    primaryCriterion,
    today,
    remainingDays,
    estimatedKmDays,
  );

  const primaryRemaining = primaryCriterion === "km" ? remainingKm : remainingDays;
  const primaryTotal = primaryCriterion === "km" ? item.rule.intervalKm : intervalDays;
  const remainingPercent = calculateRemainingPercentage(primaryRemaining, primaryTotal);

  const status = calculateMaintenanceStatus(
    item,
    { remainingKm, remainingDays, remainingPercent },
    {
      today,
      currentOdometer,
      lastInspection: lastInspectionFor(ctx.inspectionHistory, item.id),
      thresholds: ctx.settings.statusThresholds,
    },
  );

  return {
    status,
    remainingKm,
    remainingDays,
    estimatedKmDays,
    estimatedDueDate,
    remainingPercent,
    primaryCriterion,
    nextDueOdometer: dueOdometer,
    nextDueDate: dueDate,
    totalIntervalDays: intervalDays,
    lastService: lastService ? { date: lastService.date, odometer: lastService.odometer } : null,
  };
}

/** remainingKm = nextDueOdometer - currentOdometer (§22). */
export function calculateRemainingKm(
  nextDueOdometer: number | null,
  currentOdometer: number | null,
): number | null {
  if (nextDueOdometer == null || currentOdometer == null) return null;
  return nextDueOdometer - currentOdometer;
}

/** remainingDays = nextDueDate - today, in calendar days (§23). */
export function calculateRemainingDays(
  nextDueDate: string | null,
  today: string,
): number | null {
  if (nextDueDate == null) return null;
  return isoToDay(nextDueDate) - isoToDay(today);
}

/**
 * Estimated days until the km criterion triggers: remainingKm / average daily
 * distance (§24), rounded UP so the estimate never understates. Null when the
 * average distance is missing or zero (§11) or km life is not computable.
 */
export function calculateEstimatedKmDays(
  remainingKm: number | null,
  averageDailyDistance: number | null,
): number | null {
  if (remainingKm == null || averageDailyDistance == null || averageDailyDistance <= 0) {
    return null;
  }
  return Math.ceil(remainingKm / averageDailyDistance);
}

/**
 * Estimated due date (ISO) of the primary criterion (§24). This is an
 * estimate driven by average daily distance — never an exact deadline.
 */
export function calculateEstimatedDueDate(
  primaryCriterion: Criterion | null,
  today: string,
  remainingDays: number | null,
  estimatedKmDays: number | null,
): string | null {
  if (primaryCriterion === "time" && remainingDays != null) {
    return dayToIso(isoToDay(today) + remainingDays);
  }
  if (primaryCriterion === "km" && estimatedKmDays != null) {
    return dayToIso(isoToDay(today) + estimatedKmDays);
  }
  return null;
}

/**
 * remainingPercentage = remainingLife / totalConfiguredLife (§28), clamped to
 * [0, 100]. For km the total is the km interval; for time it is the exact
 * calendar days in the interval. Null when there is nothing to measure.
 */
export function calculateRemainingPercentage(
  remaining: number | null,
  total: number | null,
): number | null {
  if (remaining == null || total == null || total <= 0) return null;
  return clamp(remaining / total, 0, 1) * 100;
}

/**
 * Determines which criterion is expected to trigger first (§25): the earlier
 * of (today + estimatedKmDays) and the time due date. Ties prefer the real
 * calendar date over the distance estimate. When the distance trigger cannot
 * be estimated (no average distance) the time criterion wins; a single
 * configured criterion wins when computable.
 */
export function determinePrimaryTrigger(
  rule: Pick<MaintenanceItem["rule"], "intervalKm" | "intervalMonths">,
  metrics: {
    remainingKm: number | null;
    remainingDays: number | null;
    estimatedKmDays: number | null;
  },
): Criterion | null {
  const kmConfigured = rule.intervalKm != null;
  const timeConfigured = rule.intervalMonths != null;

  if (kmConfigured && timeConfigured) {
    const kmDays = metrics.estimatedKmDays;
    const timeDays = metrics.remainingDays;
    if (kmDays != null && timeDays != null) return kmDays < timeDays ? "km" : "time";
    if (timeDays != null) return "time";
    if (kmDays != null) return "km";
    return null;
  }
  if (kmConfigured) return metrics.remainingKm != null ? "km" : null;
  if (timeConfigured) return metrics.remainingDays != null ? "time" : null;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}