import { CURRENT_VERSION } from "../domain/defaults";
import { isIsoDate } from "../domain/odometer";
import type { Dataset } from "../domain/types";
import { migrateRaw } from "./repository";

/**
 * JSON backup / restore (§40–§43).
 *
 * Loading from local storage (repository.ts) is deliberately DEFENSIVE:
 * corrupt storage falls back to the default dataset so the app never crashes
 * (decision 13). Import is the opposite — STRICT and fail-closed: an invalid
 * file must never modify current data (§42 "If invalid: do not modify
 * existing data"). Old versions walk the SAME migration table as loading,
 * then the migrated object is validated field by field against the current
 * schema. This module is pure (no DOM/browser APIs) so it is fully
 * unit-testable.
 */

export type ImportIssueKind =
  | "notJson"
  | "notObject"
  | "missingField"
  | "wrongType"
  | "invalidValue"
  | "unsupportedVersion"
  | "duplicateId"
  | "unknownReference";

export interface ImportIssue {
  /** JSON path such as `maintenanceItems[0].rule.intervalKm`; "" for root. */
  path: string;
  kind: ImportIssueKind;
}

export type ImportResult =
  | { ok: true; dataset: Dataset }
  | { ok: false; issues: ImportIssue[] };

/** Runtime values of the model's string unions (mirrors of types.ts). */
const FUEL_TYPES = [
  "gasoline",
  "diesel",
  "hybrid",
  "electric",
  "cng",
  "lpg",
  "other",
] as const;
const DISPLAY_MODES = ["auto", "km", "time", "both"] as const;
const TRIGGERS = ["any"] as const;
const INSPECTION_CONDITIONS = ["good", "watch", "replaceSoon", "replaceNow"] as const;
const THEME_PREFERENCES = ["system", "light", "dark"] as const;

const TOP_LEVEL_FIELDS = [
  "exportedAt",
  "vehicle",
  "odometerHistory",
  "maintenanceItems",
  "serviceHistory",
  "inspectionHistory",
  "settings",
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => isString(v) && v.trim() !== "";

/* --- Export helpers (§41) --- */

/** Stamps `exportedAt` and the current schema version onto a copy. */
export function buildExport(dataset: Dataset, exportedAtIso: string): Dataset {
  return { ...dataset, version: CURRENT_VERSION, exportedAt: exportedAtIso };
}

/** Pretty-printed JSON — the downloadable backup file content. */
export function serializeExport(dataset: Dataset): string {
  return JSON.stringify(dataset, null, 2);
}

/** e.g. backupFilename("2026-09-04") → "car-maintenance-backup-2026-09-04.json". */
export function backupFilename(dateIso: string): string {
  return `car-maintenance-backup-${dateIso}.json`;
}

/* --- Strict import validation (§40 step 1–4, §42, §47) --- */

/**
 * Parses + migrates + strictly validates an imported backup file.
 * Returns the validated dataset ONLY when every check passes; any issue
 * returns ok:false and the caller must leave current data untouched.
 */
export function validateImportText(text: string): ImportResult {
  const issues: ImportIssue[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    issues.push({ path: "", kind: "notJson" });
    return { ok: false, issues };
  }

  if (!isRecord(parsed)) {
    issues.push({ path: "", kind: "notObject" });
    return { ok: false, issues };
  }

  // Version gate before anything else (§40 step 3–4).
  if (!("version" in parsed)) {
    issues.push({ path: "version", kind: "missingField" });
    return { ok: false, issues };
  }
  if (!isNumber(parsed.version)) {
    issues.push({ path: "version", kind: "wrongType" });
    return { ok: false, issues };
  }
  if (!Number.isInteger(parsed.version) || parsed.version < 0) {
    issues.push({ path: "version", kind: "invalidValue" });
    return { ok: false, issues };
  }
  if (parsed.version > CURRENT_VERSION) {
    issues.push({ path: "version", kind: "unsupportedVersion" });
    return { ok: false, issues };
  }

  let raw: Record<string, unknown> = parsed;
  if (parsed.version < CURRENT_VERSION) {
    const migrated = migrateRaw(parsed);
    if (!migrated.ok) {
      issues.push({ path: "version", kind: "invalidValue" });
      return { ok: false, issues };
    }
    raw = migrated.value;
  }

  // Required top-level fields (§42: missing fields / wrong types are fatal).
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in raw)) {
      issues.push({ path: field, kind: "missingField" });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  validateExportedAt(raw.exportedAt, issues);
  validateVehicle(raw.vehicle, "vehicle", issues);

  const odometerIds = new Set<string>();
  validateOdometerHistory(raw.odometerHistory, odometerIds, issues);

  const itemIds = new Set<string>();
  validateMaintenanceItems(raw.maintenanceItems, itemIds, issues);

  validateServiceHistory(raw.serviceHistory, itemIds, issues);
  validateInspectionHistory(raw.inspectionHistory, itemIds, issues);
  validateSettings(raw.settings, issues);

  if (issues.length > 0) return { ok: false, issues };

  return { ok: true, dataset: assembleDataset(raw) };
}

/* --- Individual schema sections --- */

function validateExportedAt(value: unknown, issues: ImportIssue[]): void {
  if (value === null) return;
  if (!isString(value)) {
    issues.push({ path: "exportedAt", kind: "wrongType" });
  } else if (Number.isNaN(Date.parse(value))) {
    issues.push({ path: "exportedAt", kind: "invalidValue" });
  }
}

function validateVehicle(raw: unknown, path: string, issues: ImportIssue[]): void {
  if (raw === null) return;
  if (!isRecord(raw)) {
    issues.push({ path, kind: "wrongType" });
    return;
  }
  checkField(issues, raw, "id", `${path}.id`, { type: "string", nonEmpty: true });
  checkField(issues, raw, "name", `${path}.name`, { type: "string", nonEmpty: true });
  checkField(issues, raw, "make", `${path}.make`, { type: "string" });
  checkField(issues, raw, "model", `${path}.model`, { type: "string" });
  checkField(issues, raw, "year", `${path}.year`, { type: "number", allowNull: true }, (v) =>
    Number.isInteger(v) && v >= 1900 && v <= 2100,
  );
  checkField(issues, raw, "fuelType", `${path}.fuelType`, { type: "string", allowNull: true }, (v) =>
    (FUEL_TYPES as readonly string[]).includes(v),
  );
  checkField(
    issues,
    raw,
    "averageDailyDistance",
    `${path}.averageDailyDistance`,
    { type: "number", allowNull: true },
    (v) => v >= 0,
  );
  checkField(issues, raw, "createdAt", `${path}.createdAt`, { type: "string", nonEmpty: true });
  checkField(issues, raw, "updatedAt", `${path}.updatedAt`, { type: "string", nonEmpty: true });
}

function validateOdometerHistory(
  raw: unknown,
  seenIds: Set<string>,
  issues: ImportIssue[],
): void {
  forEachRow(raw, "odometerHistory", issues, (row, path) => {
    checkId(row, path, seenIds, issues);
    checkField(issues, row, "date", `${path}.date`, { type: "string", nonEmpty: true }, (v) =>
      isIsoDate(v),
    );
    checkField(issues, row, "odometer", `${path}.odometer`, { type: "number" }, (v) =>
      Number.isInteger(v) && v >= 0,
    );
    checkField(issues, row, "createdAt", `${path}.createdAt`, { type: "string", nonEmpty: true });
  });
}

function validateMaintenanceItems(
  raw: unknown,
  seenIds: Set<string>,
  issues: ImportIssue[],
): void {
  forEachRow(raw, "maintenanceItems", issues, (row, path) => {
    checkId(row, path, seenIds, issues);
    checkField(issues, row, "catalogId", `${path}.catalogId`, { type: "string", allowNull: true });
    checkField(issues, row, "name", `${path}.name`, { type: "string", nonEmpty: true });
    checkField(issues, row, "category", `${path}.category`, { type: "string", nonEmpty: true });
    checkField(issues, row, "icon", `${path}.icon`, { type: "string", nonEmpty: true });
    checkField(issues, row, "active", `${path}.active`, { type: "boolean" });
    checkField(issues, row, "createdAt", `${path}.createdAt`, { type: "string", nonEmpty: true });
    checkField(issues, row, "updatedAt", `${path}.updatedAt`, { type: "string", nonEmpty: true });

    // rule (object) + its criteria
    if (!("rule" in row)) {
      issues.push({ path: `${path}.rule`, kind: "missingField" });
      return;
    }
    if (!isRecord(row.rule)) {
      issues.push({ path: `${path}.rule`, kind: "wrongType" });
      return;
    }
    const rule = row.rule;
    const rulePath = `${path}.rule`;
    checkField(issues, rule, "intervalKm", `${rulePath}.intervalKm`, { type: "number", allowNull: true }, (v) =>
      Number.isInteger(v) && v > 0,
    );
    checkField(issues, rule, "intervalMonths", `${rulePath}.intervalMonths`, { type: "number", allowNull: true }, (v) =>
      Number.isInteger(v) && v > 0,
    );
    checkField(issues, rule, "trigger", `${rulePath}.trigger`, { type: "string", nonEmpty: true }, (v) =>
      (TRIGGERS as readonly string[]).includes(v),
    );
    checkField(issues, rule, "displayMode", `${rulePath}.displayMode`, { type: "string", nonEmpty: true }, (v) =>
      (DISPLAY_MODES as readonly string[]).includes(v),
    );
    checkField(issues, rule, "inspectionBased", `${rulePath}.inspectionBased`, { type: "boolean" });
    // A rule must actually track something (§16/§37) — the UI enforces this
    // at creation, so an imported item with no criterion is malformed.
    if (rule.inspectionBased === false && rule.intervalKm == null && rule.intervalMonths == null) {
      issues.push({ path: rulePath, kind: "invalidValue" });
    }
  });
}

function validateServiceHistory(
  raw: unknown,
  itemIds: Set<string>,
  issues: ImportIssue[],
): void {
  const seenIds = new Set<string>();
  forEachRow(raw, "serviceHistory", issues, (row, path) => {
    checkId(row, path, seenIds, issues);
    checkItemReference(row, path, itemIds, issues);
    checkField(issues, row, "date", `${path}.date`, { type: "string", nonEmpty: true }, (v) =>
      isIsoDate(v),
    );
    checkField(issues, row, "odometer", `${path}.odometer`, { type: "number", allowNull: true }, (v) =>
      Number.isInteger(v) && v >= 0,
    );
    checkField(issues, row, "notes", `${path}.notes`, { type: "string" });
    checkField(issues, row, "cost", `${path}.cost`, { type: "number", allowNull: true }, (v) => v >= 0);
    checkField(issues, row, "createdAt", `${path}.createdAt`, { type: "string", nonEmpty: true });
  });
}

function validateInspectionHistory(
  raw: unknown,
  itemIds: Set<string>,
  issues: ImportIssue[],
): void {
  const seenIds = new Set<string>();
  forEachRow(raw, "inspectionHistory", issues, (row, path) => {
    checkId(row, path, seenIds, issues);
    checkItemReference(row, path, itemIds, issues);
    checkField(issues, row, "date", `${path}.date`, { type: "string", nonEmpty: true }, (v) =>
      isIsoDate(v),
    );
    checkField(issues, row, "odometer", `${path}.odometer`, { type: "number", allowNull: true }, (v) =>
      Number.isInteger(v) && v >= 0,
    );
    checkField(issues, row, "condition", `${path}.condition`, { type: "string", allowNull: true }, (v) =>
      (INSPECTION_CONDITIONS as readonly string[]).includes(v),
    );
    checkField(issues, row, "measurement", `${path}.measurement`, { type: "number", allowNull: true }, (v) => v >= 0);
    checkField(issues, row, "notes", `${path}.notes`, { type: "string" });
    checkField(issues, row, "createdAt", `${path}.createdAt`, { type: "string", nonEmpty: true });
  });
}

function validateSettings(raw: unknown, issues: ImportIssue[]): void {
  if (!isRecord(raw)) {
    issues.push({ path: "settings", kind: "wrongType" });
    return;
  }
  if (!("statusThresholds" in raw)) {
    issues.push({ path: "settings.statusThresholds", kind: "missingField" });
    return;
  }
  if (!isRecord(raw.statusThresholds)) {
    issues.push({ path: "settings.statusThresholds", kind: "wrongType" });
    return;
  }
  const thresholds = raw.statusThresholds;
  checkField(issues, thresholds, "dueSoonPercent", "settings.statusThresholds.dueSoonPercent", { type: "number" }, (v) =>
    v >= 0 && v <= 100,
  );
  checkField(issues, thresholds, "duePercent", "settings.statusThresholds.duePercent", { type: "number" }, (v) =>
    v >= 0 && v <= 100,
  );
  checkField(issues, raw, "theme", "settings.theme", { type: "string", nonEmpty: true }, (v) =>
    (THEME_PREFERENCES as readonly string[]).includes(v),
  );
  if (
    isNumber(thresholds.dueSoonPercent) &&
    isNumber(thresholds.duePercent) &&
    thresholds.duePercent > thresholds.dueSoonPercent
  ) {
    issues.push({ path: "settings.statusThresholds", kind: "invalidValue" });
  }
}

/* --- Small shared checks --- */

type FieldType = "string" | "number" | "boolean" | "object";

interface FieldOptions<T extends FieldType> {
  type: T;
  /** null is allowed (e.g. vehicle absent, optional odometer). */
  allowNull?: boolean;
  /** Strings must not be blank. */
  nonEmpty?: boolean;
}

type FieldValue<T extends FieldType> = T extends "string"
  ? string
  : T extends "number"
    ? number
    : T extends "boolean"
      ? boolean
      : Record<string, unknown>;

/** Presence + type (+ value-range) check for one object field. */
function checkField<T extends FieldType>(
  issues: ImportIssue[],
  obj: Record<string, unknown>,
  field: string,
  path: string,
  opts: FieldOptions<T>,
  valueCheck?: (value: FieldValue<T>) => boolean,
): void {
  if (!(field in obj)) {
    issues.push({ path, kind: "missingField" });
    return;
  }
  const value = obj[field];
  if (value === null) {
    if (!opts.allowNull) issues.push({ path, kind: "wrongType" });
    return;
  }
  const typeMatches =
    opts.type === "string"
      ? isString(value)
      : opts.type === "number"
        ? isNumber(value)
        : opts.type === "boolean"
          ? typeof value === "boolean"
          : isRecord(value);
  if (!typeMatches) {
    issues.push({ path, kind: "wrongType" });
    return;
  }
  if (opts.type === "string" && opts.nonEmpty && (value as string).trim() === "") {
    issues.push({ path, kind: "invalidValue" });
    return;
  }
  if (valueCheck && !valueCheck(value as FieldValue<T>)) {
    issues.push({ path, kind: "invalidValue" });
  }
}

/** Walks a top-level array field; each element must be an object. */
function forEachRow(
  raw: unknown,
  field: string,
  issues: ImportIssue[],
  visit: (row: Record<string, unknown>, path: string) => void,
): void {
  if (!Array.isArray(raw)) {
    issues.push({ path: field, kind: "wrongType" });
    return;
  }
  raw.forEach((element, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(element)) {
      issues.push({ path, kind: "wrongType" });
      return;
    }
    visit(element, path);
  });
}

/** Row id: required non-empty string, unique within its collection (§47). */
function checkId(
  row: Record<string, unknown>,
  path: string,
  seenIds: Set<string>,
  issues: ImportIssue[],
): void {
  const value = row.id;
  if (!isNonEmptyString(value)) {
    issues.push({ path: `${path}.id`, kind: value == null ? "missingField" : "invalidValue" });
    return;
  }
  if (seenIds.has(value)) {
    issues.push({ path: `${path}.id`, kind: "duplicateId" });
    return;
  }
  seenIds.add(value);
}

/** service/inspection rows must reference an item that exists in the file. */
function checkItemReference(
  row: Record<string, unknown>,
  path: string,
  itemIds: Set<string>,
  issues: ImportIssue[],
): void {
  const value = row.maintenanceItemId;
  if (isNonEmptyString(value) && !itemIds.has(value)) {
    issues.push({ path: `${path}.maintenanceItemId`, kind: "unknownReference" });
  }
}

/** Builds the typed dataset. Only called when validation passed. */
function assembleDataset(raw: Record<string, unknown>): Dataset {
  return {
    version: CURRENT_VERSION,
    exportedAt: raw.exportedAt as string | null,
    vehicle: raw.vehicle as Dataset["vehicle"],
    odometerHistory: raw.odometerHistory as Dataset["odometerHistory"],
    maintenanceItems: raw.maintenanceItems as Dataset["maintenanceItems"],
    serviceHistory: raw.serviceHistory as Dataset["serviceHistory"],
    inspectionHistory: raw.inspectionHistory as Dataset["inspectionHistory"],
    settings: raw.settings as Dataset["settings"],
  };
}
