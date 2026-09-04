import {
  CATALOG,
  CATEGORIES,
  categoryName,
  type CatalogCategoryId,
  type CatalogEntry,
} from "../catalog";
import { lastInspectionFor, lastServiceFor } from "../domain/baselines";
import { createId } from "../domain/ids";
import {
  buildItem,
  validateInitialInspection,
  validateInitialService,
  validateItemDraft,
  type InitialDataError,
  type ItemDraft,
  type ItemDraftError,
} from "../domain/item-factory";
import { calculateMaintenance, todayIso } from "../domain/maintenance";
import { getCurrentOdometer } from "../domain/odometer";
import {
  sortHistoryNewestFirst,
  validateInspectionRecordEntry,
  validateServiceRecordEntry,
  type InspectionRecordError,
  type ServiceRecordError,
} from "../domain/records";
import type {
  DisplayMode,
  InspectionCondition,
  MaintenanceItem,
  ServiceRecord,
  InspectionRecord,
} from "../domain/types";
import { t, type MessageKey } from "../i18n";
import { store } from "../state/store";
import { googleCalendarUrl } from "../ui/calendar";
import { bindDateFields, dateFieldHtml } from "../ui/date-field";
import { escHtml } from "../ui/escape";
import { faNum, formatDate, toLatinDigits } from "../ui/format";
import { applyIcons, CUSTOM_ICON_CHOICES, STATUS_ICONS } from "../ui/icons";
import {
  compareByUrgency,
  dueDateText,
  primaryMetricText,
  resolvePrimaryMetric,
  secondaryMetricText,
  statusLabel,
} from "../ui/maintenance-display";
import { maintenanceDetailHash, maintenanceItemIdFromHash } from "../ui/router";

/**
 * Maintenance view (Phases 5–8): active items list + catalog browser + the
 * unified add/edit configuration form (§19, §26) AND, new in Phase 8, the
 * item detail page (§32–§36): status/calculations overview, §33
 * explanation, service + inspection history, record/edit service &
 * inspection events, reactivate/delete lifecycle.
 *
 * The detail page is a MODE of this view, driven by the hash
 * `#/maintenance/<itemId>` — no separate nav entry; the نگهداری tab stays
 * highlighted and the store subscription/dispose wiring in main.ts is
 * untouched.
 */

type ConfigState =
  | { mode: "catalog-add"; entryId: string }
  | { mode: "edit"; itemId: string };

type RecordFormState =
  | { kind: "service"; recordId: string | null; itemId: string }
  | { kind: "inspection"; recordId: string | null; itemId: string };

interface MaintenanceViewState {
  tab: "catalog" | "custom";
  search: string;
  /** Current form selections (survive re-renders). */
  icon: string;
  displayMode: DisplayMode;
  inspectionBased: boolean;
  config: ConfigState | null;
  sort: "urgency" | "name";
  /** Open record form on the detail page (null = closed). */
  recordForm: RecordFormState | null;
  /** Item armed for permanent deletion (inline confirm). */
  deleteArmedId: string | null;
  /** Typed item-form field values keyed by input name — survives re-renders
   * so an unrelated store update never wipes a half-filled form (decision
   * 31); empty means “use the prefill”. */
  formValues: Record<string, string>;
}

const state: MaintenanceViewState = {
  tab: "catalog",
  search: "",
  icon: "wrench",
  displayMode: "auto",
  inspectionBased: false,
  config: null,
  sort: "urgency",
  recordForm: null,
  deleteArmedId: null,
  formValues: {},
};

/** Typed item-form field value that survives re-renders (decision 31). */
function fieldValue(field: string, fallback: string = ""): string {
  return state.formValues[field] ?? fallback;
}

/** Keeps typed item-form fields in state so redraws never wipe them. */
function captureItemFormValue(event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  if (!target || !target.name || target.type === "checkbox") return;
  state.formValues[target.name] = target.value;
}

const DISPLAY_OPTIONS: readonly { value: DisplayMode; key: MessageKey }[] = [
  { value: "auto", key: "maintenance.display.auto" },
  { value: "km", key: "maintenance.display.km" },
  { value: "time", key: "maintenance.display.time" },
  { value: "both", key: "maintenance.display.both" },
];

const CONDITION_OPTIONS: readonly { value: InspectionCondition; key: MessageKey }[] = [
  { value: "good", key: "maintenance.condition.good" },
  { value: "watch", key: "maintenance.condition.watch" },
  { value: "replaceSoon", key: "maintenance.condition.replaceSoon" },
  { value: "replaceNow", key: "maintenance.condition.replaceNow" },
];

const DRAFT_ERROR_FIELD: Record<ItemDraftError, string> = {
  nameRequired: "item-error-name",
  kmInvalid: "item-error-km",
  monthsInvalid: "item-error-months",
  ruleRequired: "item-error-rule",
};

const DRAFT_ERROR_KEYS: Record<ItemDraftError, MessageKey> = {
  nameRequired: "maintenance.custom.errorNameRequired",
  kmInvalid: "maintenance.custom.errorKmInvalid",
  monthsInvalid: "maintenance.custom.errorMonthsInvalid",
  ruleRequired: "maintenance.custom.errorRuleRequired",
};

const INITIAL_ERROR_KEYS: Record<InitialDataError, MessageKey> = {
  missingDate: "maintenance.form.errorMissingDate",
  invalidDate: "maintenance.form.errorInvalidDate",
  futureDate: "maintenance.form.errorFutureDate",
  invalidOdometer: "maintenance.form.errorInvalidOdometer",
};

const SERVICE_ERROR_KEYS: Record<ServiceRecordError, MessageKey> = {
  missingDate: "maintenance.record.errorMissingDate",
  invalidDate: "maintenance.record.errorInvalidDate",
  futureDate: "maintenance.record.errorFutureDate",
  invalidOdometer: "maintenance.record.errorInvalidOdometer",
  invalidCost: "maintenance.record.errorInvalidCost",
};

const INSPECTION_ERROR_KEYS: Record<InspectionRecordError, MessageKey> = {
  missingDate: "maintenance.record.errorMissingDate",
  invalidDate: "maintenance.record.errorInvalidDate",
  futureDate: "maintenance.record.errorFutureDate",
  invalidOdometer: "maintenance.record.errorInvalidOdometer",
  invalidMeasurement: "maintenance.record.errorInvalidMeasurement",
  conditionRequired: "maintenance.record.errorConditionRequired",
};

export function renderMaintenance(container: HTMLElement): () => void {
  const draw = (): void => {
    container.innerHTML = maintenanceViewHtml();
    bind(container);
    applyIcons();
  };
  draw();
  return store.subscribe(draw);
}

/* --- Top-level branch: config form → detail page → list page --- */

function maintenanceViewHtml(): string {
  if (state.config) {
    return `
      <div class="view-stack">
        <h1 class="view-title">${t("view.maintenance.title")}</h1>
        ${configFormHtml()}
      </div>
    `;
  }
  const itemId = maintenanceItemIdFromHash(window.location.hash);
  if (itemId) return itemDetailPageHtml(itemId);

  const activeItems = store.get().maintenanceItems.filter((item) => item.active);
  const inactiveItems = store.get().maintenanceItems.filter((item) => !item.active);
  return `
    <div class="view-stack">
      <h1 class="view-title">${t("view.maintenance.title")}</h1>
      <section class="card">
        <h2 class="card__title">${t("maintenance.activeTitle")}</h2>
        ${activeItemsHtml(activeItems)}
      </section>
      ${inactiveItems.length > 0 ? inactiveItemsSectionHtml(inactiveItems) : ""}
      <section class="card">
        <h2 class="card__title">${t("maintenance.addTitle")}</h2>
        <div class="tabs" role="tablist">
          <button type="button" class="tabs__tab js-tab-catalog" role="tab"
            aria-selected="${state.tab === "catalog"}" data-tab="catalog">
            ${t("maintenance.catalogTab")}
          </button>
          <button type="button" class="tabs__tab js-tab-custom" role="tab"
            aria-selected="${state.tab === "custom"}" data-tab="custom">
            ${t("maintenance.customTab")}
          </button>
        </div>
        ${state.tab === "catalog" ? catalogBrowserHtml() : customFormHtml()}
      </section>
    </div>
  `;
}

/* --- Active items list (list page) --- */

function activeItemsHtml(items: MaintenanceItem[]): string {
  if (items.length === 0) return `<p class="empty-note">${t("maintenance.noActiveItems")}</p>`;

  const dataset = store.get();
  const sorted = [...items].sort((a, b) => {
    if (state.sort === "name") return a.name.localeCompare(b.name, "fa");
    const calcA = calculateMaintenance(a, dataset);
    const calcB = calculateMaintenance(b, dataset);
    return compareByUrgency(
      { status: calcA.status, remainingPercent: calcA.remainingPercent },
      { status: calcB.status, remainingPercent: calcB.remainingPercent },
    );
  });

  const sortControl = `
    <div class="segmented segmented--small">
      <button type="button" class="segmented__option js-sort-option ${state.sort === "urgency" ? "segmented__option--active" : ""}" data-sort="urgency">
        ${t("maintenance.list.sortUrgency")}
      </button>
      <button type="button" class="segmented__option js-sort-option ${state.sort === "name" ? "segmented__option--active" : ""}" data-sort="name">
        ${t("maintenance.list.sortName")}
      </button>
    </div>
  `;

  return `
    ${sortControl}
    <ul class="item-list">
      ${sorted.map((item) => activeItemRowHtml(item, dataset)).join("")}
    </ul>
  `;
}

/** Metric lines for a row/detail header (no calc duplication — display only). */
function itemMetricLines(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): {
  primaryLine: string | null;
  secondaryLine: string | null;
  dateLine: string | null;
  percent: number | null;
  calc: ReturnType<typeof calculateMaintenance>;
} {
  const calc = calculateMaintenance(item, dataset);
  const kind = resolvePrimaryMetric(calc, item.rule.displayMode);

  let primaryLine: string | null;
  if (item.rule.inspectionBased) {
    const lastInspection = lastInspectionFor(dataset.inspectionHistory, item.id);
    primaryLine =
      lastInspection?.condition != null
        ? `${t("maintenance.list.conditionLabel")}: ${t(`maintenance.condition.${lastInspection.condition}` as never)}`
        : null;
  } else {
    primaryLine = primaryMetricText(calc, kind);
  }
  const secondaryLine = secondaryMetricText(calc, kind);
  const dateLine = dueDateText(calc, kind);
  return {
    primaryLine,
    secondaryLine,
    dateLine,
    percent: calc.remainingPercent,
    calc,
  };
}

function activeItemRowHtml(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): string {
  const lines = itemMetricLines(item, dataset);

  return `
    <li class="item-list__row">
      <a class="item-list__main" href="${maintenanceDetailHash(item.id)}">
        <span class="item-list__icon" data-lucide="${item.icon}"></span>
        <div class="item-list__info">
          <div class="item-list__head">
            <span class="item-list__name">${escHtml(item.name)}</span>
            <span class="status-chip status-chip--${lines.calc.status}">
              <span data-lucide="${STATUS_ICONS[lines.calc.status]}"></span>
              ${statusLabel(lines.calc.status)}
            </span>
          </div>
          <div class="item-list__meta">${categoryName(item.category)}</div>
          ${lines.primaryLine ? `<div class="metric metric--primary">${lines.primaryLine}</div>` : ""}
          ${lines.secondaryLine ? `<div class="metric">${lines.secondaryLine}</div>` : ""}
          ${lines.dateLine ? `<div class="metric metric--muted">${lines.dateLine}</div>` : ""}
          ${lines.percent != null ? progressHtml(lines.percent, lines.calc.status, item.name) : ""}
        </div>
      </a>
      <div class="item-list__actions">
        <button type="button" class="btn btn--text js-edit-item" data-id="${escHtml(item.id)}">
          ${t("maintenance.editItem")}
        </button>
        <button type="button" class="btn btn--text js-deactivate-item" data-id="${escHtml(item.id)}">
          ${t("maintenance.deactivate")}
        </button>
      </div>
    </li>
  `;
}

function progressHtml(percent: number, status: string, label: string): string {
  const rounded = Math.round(percent);
  return `
    <div class="progress progress--${status}" role="progressbar"
      aria-valuenow="${rounded}" aria-valuemin="0" aria-valuemax="100" aria-label="${escHtml(label)}">
      <div class="progress__fill" style="width:${rounded}%"></div>
    </div>
  `;
}

/* --- Deactivated items section (list page, Phase 8 lifecycle) --- */

function inactiveItemsSectionHtml(items: MaintenanceItem[]): string {
  return `
    <section class="card">
      <h2 class="card__title">${t("maintenance.inactiveTitle")}</h2>
      <ul class="item-list">
        ${items.map(inactiveItemRowHtml).join("")}
      </ul>
    </section>
  `;
}

function inactiveItemRowHtml(item: MaintenanceItem): string {
  const armed = state.deleteArmedId === item.id;
  const actions = armed
    ? deleteConfirmInline(item.id)
    : `
      <button type="button" class="btn btn--text js-reactivate-item" data-id="${escHtml(item.id)}">
        ${t("maintenance.detail.reactivate")}
      </button>
      <button type="button" class="btn btn--text js-arm-delete" data-id="${escHtml(item.id)}">
        ${t("maintenance.detail.delete")}
      </button>
    `;
  return `
    <li class="item-list__row">
      <a class="item-list__main" href="${maintenanceDetailHash(item.id)}">
        <span class="item-list__icon" data-lucide="${item.icon}"></span>
        <div class="item-list__info">
          <div class="item-list__name">${escHtml(item.name)}</div>
          <div class="item-list__meta">${categoryName(item.category)}</div>
        </div>
      </a>
      <div class="item-list__actions">${actions}</div>
    </li>
  `;
}

function deleteConfirmInline(itemId: string): string {
  return `
    <span class="delete-confirm">
      <button type="button" class="btn btn--filled btn--danger js-confirm-delete" data-id="${escHtml(itemId)}">
        ${t("maintenance.detail.confirm")}
      </button>
      <button type="button" class="btn btn--text js-cancel-delete">${t("maintenance.detail.cancel")}</button>
    </span>
  `;
}

/* --- Catalog browser (list page) --- */

function catalogBrowserHtml(): string {
  const query = state.search.trim().toLowerCase();
  const matches = (entry: CatalogEntry): boolean => {
    if (query === "") return true;
    return (
      entry.name.fa.toLowerCase().includes(query) ||
      entry.name.en.toLowerCase().includes(query) ||
      categoryName(entry.category).toLowerCase().includes(query)
    );
  };

  const groups = CATEGORIES.map((category) => ({
    category,
    entries: CATALOG.filter((entry) => entry.category === category.id && matches(entry)),
  })).filter((group) => group.entries.length > 0);

  const body =
    groups.length === 0
      ? `<p class="empty-note">${t("maintenance.noSearchResults")}</p>`
      : groups
          .map(
            (group) => `
              <div class="catalog-group">
                <h3 class="catalog-group__title">${categoryName(group.category.id)}</h3>
                <ul class="item-list">
                  ${group.entries.map(catalogRowHtml).join("")}
                </ul>
              </div>
            `,
          )
          .join("");

  return `
    <div class="catalog">
      <input class="field__input js-catalog-search" type="search"
        value="${escHtml(state.search)}" placeholder="${t("maintenance.searchPlaceholder")}"
        aria-label="${t("maintenance.searchPlaceholder")}" />
      <p class="field__hint">${t("maintenance.recommendationNote")}</p>
      ${body}
    </div>
  `;
}

function catalogRowHtml(entry: CatalogEntry): string {
  const range = [
    entry.kmRange
      ? `${faNum(entry.kmRange[0])}–${faNum(entry.kmRange[1])} ${t("common.kmUnit")}`
      : entry.suggestedKm != null
        ? `${faNum(entry.suggestedKm)} ${t("common.kmUnit")}`
        : null,
    entry.monthsRange
      ? `${faNum(entry.monthsRange[0])}–${faNum(entry.monthsRange[1])} ${t("maintenance.monthsUnit")}`
      : entry.suggestedMonths != null
        ? `${faNum(entry.suggestedMonths)} ${t("maintenance.monthsUnit")}`
        : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  const suggestion = [
    entry.suggestedKm != null ? `${faNum(entry.suggestedKm)} ${t("common.kmUnit")}` : null,
    entry.suggestedMonths != null
      ? `${faNum(entry.suggestedMonths)} ${t("maintenance.monthsUnit")}`
      : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  const recommendedLine = entry.inspectionBased
    ? [t("maintenance.inspectionBased"), range].filter(Boolean).join(" · ")
    : `${t("maintenance.recommendedLabel")}: ${range}`;

  return `
    <li class="item-list__row">
      <span class="item-list__icon" data-lucide="${entry.icon}"></span>
      <span class="item-list__info">
        <span class="item-list__name">${entry.name.fa}</span>
        <span class="item-list__meta">${recommendedLine}</span>
        ${suggestion ? `<span class="item-list__meta">${t("maintenance.suggestedLabel")}: ${suggestion}</span>` : ""}
      </span>
      <button type="button" class="btn btn--filled js-add-catalog-item" data-id="${escHtml(entry.id)}">
        ${t("maintenance.add")}
      </button>
    </li>
  `;
}

/* --- Detail page (§32–§36) --- */

function itemDetailPageHtml(itemId: string): string {
  const dataset = store.get();
  const item = dataset.maintenanceItems.find((candidate) => candidate.id === itemId);
  if (!item) {
    return `
      <div class="view-stack">
        <a class="btn btn--text detail-back" href="#/maintenance">${t("maintenance.detail.backToList")}</a>
        <section class="card"><p class="empty-note">${t("maintenance.detail.notFound")}</p></section>
      </div>
    `;
  }

  const inactive = !item.active;
  const backLink = `<a class="btn btn--text detail-back" href="#/maintenance">${t("maintenance.detail.backToList")}</a>`;

  // §32 overview
  const overviewHtml = detailOverviewHtml(item, dataset);

  // Record form (opened via the actions row). Ignore forms scoped to
  // another item (stale module state after navigation).
  const recordForm = state.recordForm && state.recordForm.itemId === item.id ? state.recordForm : null;
  const recordFormHtmlValue = recordForm
    ? recordForm.kind === "service"
      ? recordServiceFormHtml()
      : recordInspectionFormHtml()
    : "";

  // Actions row
  const actionRow = detailActionRowHtml(item, inactive, overviewHtml.calc);

  // History sections (§34/§36)
  const services = dataset.serviceHistory.filter((r) => r.maintenanceItemId === itemId);
  const inspections = dataset.inspectionHistory.filter((r) => r.maintenanceItemId === itemId);
  const historyHtml = detailHistoryHtml(item, services, inspections);

  const headChip = inactive
    ? `<span class="status-chip status-chip--inactive">${t("maintenance.detail.inactiveBadge")}</span>`
    : `<span class="status-chip status-chip--${overviewHtml.calc.status}">
        <span data-lucide="${STATUS_ICONS[overviewHtml.calc.status]}"></span>
        ${statusLabel(overviewHtml.calc.status)}
      </span>`;

  return `
    <div class="view-stack">
      ${backLink}
      <section class="card">
        <div class="detail-head">
          <span class="item-list__icon" data-lucide="${item.icon}"></span>
          <div class="detail-head__info">
            <div class="detail-head__title">
              <span class="item-list__name">${escHtml(item.name)}</span>
              ${headChip}
            </div>
            <div class="item-list__meta">${categoryName(item.category)}</div>
          </div>
        </div>
        <div class="detail-actions">
          ${actionRow}
        </div>
      </section>
      ${recordFormHtmlValue}
      ${overviewHtml.html}
      ${historyHtml}
    </div>
  `;
}

/** Actions shown on the detail page header (§32). */
function detailActionRowHtml(
  item: MaintenanceItem,
  inactive: boolean,
  calc: ReturnType<typeof calculateMaintenance>,
): string {
  if (state.deleteArmedId === item.id) {
    return `
      <span class="detail-actions__confirm">${t("maintenance.detail.deleteConfirm")}</span>
      ${deleteConfirmInline(item.id)}
    `;
  }
  const buttons: string[] = [];
  if (inactive) {
    buttons.push(`
      <button type="button" class="btn btn--filled js-reactivate-item" data-id="${escHtml(item.id)}">
        ${t("maintenance.detail.reactivate")}
      </button>
    `);
  } else if (item.rule.inspectionBased) {
    buttons.push(`
      <button type="button" class="btn btn--filled js-record-inspection" data-id="${escHtml(item.id)}">
        ${t("maintenance.record.inspectionTitle")}
      </button>
    `);
  } else {
    buttons.push(`
      <button type="button" class="btn btn--filled js-record-service" data-id="${escHtml(item.id)}">
        ${t("maintenance.record.serviceTitle")}
      </button>
    `);
  }
  buttons.push(`
    <button type="button" class="btn btn--text js-edit-item" data-id="${escHtml(item.id)}">
      ${t("maintenance.editItem")}
    </button>
  `);
  // §38: manual “add to Google Calendar” link when a date is computable.
  const calendarHref = calendarEventHref(item, calc);
  if (calendarHref && !inactive) {
    buttons.push(`
      <a class="btn btn--text" href="${escHtml(calendarHref)}" target="_blank" rel="noopener noreferrer">
        <span data-lucide="calendar-plus"></span>
        ${t("maintenance.detail.addToCalendar")}
      </a>
    `);
  }
  if (!inactive) {
    buttons.push(`
      <button type="button" class="btn btn--text js-deactivate-item" data-id="${escHtml(item.id)}">
        ${t("maintenance.deactivate")}
      </button>
    `);
  } else {
    buttons.push(`
      <button type="button" class="btn btn--text js-arm-delete" data-id="${escHtml(item.id)}">
        ${t("maintenance.detail.delete")}
      </button>
    `);
  }
  return buttons.join("");
}

/**
 * §38 Google Calendar event link for an item: title = item name, date =
 * the primary criterion's estimated/next due date (real when the time
 * criterion anchors it, estimated for km-driven items), details = a short
 * description. Returns null when no date is computable (nothing to remind
 * about — e.g. no baseline yet or km-only without an average).
 */
function calendarEventHref(
  item: MaintenanceItem,
  calc: ReturnType<typeof calculateMaintenance>,
): string | null {
  const date = calc.estimatedDueDate ?? calc.nextDueDate;
  if (!date) return null;
  const descriptionLines: string[] = [];
  if (item.rule.inspectionBased) {
    descriptionLines.push(t("maintenance.detail.lastInspection"));
  } else {
    const last = lastServiceFor(store.get().serviceHistory, item.id);
    if (last) {
      descriptionLines.push(
        `${t("maintenance.detail.lastService")}: ${formatDate(last.date)}${
          last.odometer != null ? ` (${faNum(last.odometer)} ${t("common.kmUnit")})` : ""
        }`,
      );
    }
    descriptionLines.push(`${t("maintenance.detail.calendarEventNote")}: ${formatDate(date)}`);
  }
  return googleCalendarUrl({
    title: item.name,
    date,
    details: descriptionLines.join("\n"),
  });
}

/** §32 status/remaining overview card + §33 calculation explanation. */
function detailOverviewHtml(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): {
  html: string;
  calc: ReturnType<typeof calculateMaintenance>;
} {
  const lines = itemMetricLines(item, dataset);
  const calc = lines.calc;
  const rule = item.rule;
  const km = rule.intervalKm;
  const months = rule.intervalMonths;
  const intervalValue = [
    km != null ? `${faNum(km)} ${t("common.kmUnit")}` : null,
    months != null ? `${faNum(months)} ${t("maintenance.monthsUnit")}` : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  // §33 explanation rows (only meaningful facts).
  const rows: { label: string; value: string }[] = [];

  if (rule.inspectionBased) {
    const last = lastInspectionFor(dataset.inspectionHistory, item.id);
    rows.push({
      label: t("maintenance.detail.lastInspection"),
      value: last
        ? `${formatDate(last.date)}${
            last.condition ? ` — ${t(`maintenance.condition.${last.condition}` as never)}` : ""
          }`
        : t("maintenance.detail.neverInspected"),
    });
    rows.push({ label: t("maintenance.detail.configuredInterval"), value: intervalValue });
  } else {
    const last = lastServiceFor(dataset.serviceHistory, item.id);
    rows.push({ label: t("maintenance.detail.configuredInterval"), value: intervalValue });
    rows.push({
      label: t("maintenance.detail.lastService"),
      value: last
        ? `${formatDate(last.date)}${
            last.odometer != null ? ` — ${faNum(last.odometer)} ${t("common.kmUnit")}` : ""
          }`
        : t("maintenance.detail.neverServiced"),
    });
    if (last && (km != null || months != null)) {
      const parts: string[] = [];
      if (calc.nextDueOdometer != null) {
        parts.push(`${faNum(calc.nextDueOdometer)} ${t("common.kmUnit")}`);
      }
      if (calc.nextDueDate) {
        parts.push(formatDate(calc.nextDueDate));
      }
      if (parts.length > 0) {
        rows.push({ label: t("maintenance.detail.serviceAfter"), value: parts.join(" · ") });
      }
    }
  }

  const current = getCurrentOdometer(dataset);
  rows.push({
    label: t("maintenance.detail.currentOdometer"),
    value: current ? `${faNum(current.odometer)} ${t("common.kmUnit")}` : t("maintenance.detail.notRecorded"),
  });

  const avg = dataset.vehicle?.averageDailyDistance;
  if (avg != null && avg > 0 && calc.estimatedKmDays != null) {
    rows.push({
      label: t("maintenance.detail.avgDaily"),
      value: `${faNum(avg)} ${t("vehicle.averageDailyUnit")}`,
    });
    if (calc.estimatedDueDate) {
      rows.push({
        label: t("maintenance.detail.estimateNote"),
        value: formatDate(calc.estimatedDueDate),
      });
    }
  }
  if (!rule.inspectionBased && km != null && months != null && calc.primaryCriterion) {
    rows.push({
      label: t("maintenance.detail.triggerLabel"),
      value: calc.primaryCriterion === "km" ? t("maintenance.detail.triggerKm") : t("maintenance.detail.triggerTime"),
    });
  }

  const explainRows = rows
    .map(
      (row) => `
        <div class="info-list__row"><dt>${escHtml(row.label)}</dt><dd>${escHtml(row.value)}</dd></div>
      `,
    )
    .join("");

  return {
    calc,
    html: `
      <section class="card">
        <h2 class="card__title">${t("maintenance.detail.overviewTitle")}</h2>
        <div class="detail-metrics">
          ${lines.primaryLine ? `<div class="metric metric--primary">${lines.primaryLine}</div>` : ""}
          ${lines.secondaryLine ? `<div class="metric">${lines.secondaryLine}</div>` : ""}
          ${lines.dateLine ? `<div class="metric metric--muted">${lines.dateLine}</div>` : ""}
        </div>
        ${lines.percent != null ? progressHtml(lines.percent, calc.status, item.name) : ""}
        ${explainRows ? `<dl class="info-list">${explainRows}</dl>` : ""}
      </section>
    `,
  };
}

/** §34/§36 history sections: service records and inspection records. */
function detailHistoryHtml(
  item: MaintenanceItem,
  services: ServiceRecord[],
  inspections: InspectionRecord[],
): string {
  const serviceRows = sortHistoryNewestFirst(services)
    .map(
      (record) => `
        <li class="history__item">
          <div>
            <div class="history__date">${formatDate(record.date)}</div>
            ${
              record.odometer != null
                ? `<div class="history__km">${faNum(record.odometer)} ${t("common.kmUnit")}</div>`
                : ""
            }
            ${record.cost != null ? `<div class="history__km">${t("maintenance.detail.costLabel")}: ${faNum(record.cost)}</div>` : ""}
            ${record.notes ? `<div class="history__note">${escHtml(record.notes)}</div>` : ""}
          </div>
          <button type="button" class="btn btn--text js-edit-record" data-kind="service" data-id="${escHtml(record.id)}">
            ${t("maintenance.detail.editRecord")}
          </button>
        </li>
      `,
    )
    .join("");

  const inspectionRows = sortHistoryNewestFirst(inspections)
    .map(
      (record) => `
        <li class="history__item">
          <div>
            <div class="history__date">${formatDate(record.date)}</div>
            ${
              record.condition
                ? `<div class="history__km">${t("maintenance.list.conditionLabel")}: ${t(`maintenance.condition.${record.condition}` as never)}</div>`
                : ""
            }
            ${
              record.odometer != null
                ? `<div class="history__km">${faNum(record.odometer)} ${t("common.kmUnit")}</div>`
                : ""
            }
            ${
              record.measurement != null
                ? `<div class="history__km">${t("maintenance.detail.measurementLabel")}: ${faNum(record.measurement)}</div>`
                : ""
            }
            ${record.notes ? `<div class="history__note">${escHtml(record.notes)}</div>` : ""}
          </div>
          <button type="button" class="btn btn--text js-edit-record" data-kind="inspection" data-id="${escHtml(record.id)}">
            ${t("maintenance.detail.editRecord")}
          </button>
        </li>
      `,
    )
    .join("");

  const showServices = !item.rule.inspectionBased || services.length > 0;
  const showInspections = item.rule.inspectionBased || inspections.length > 0;

  const serviceSection = showServices
    ? `
      <section class="card history">
        <h2 class="card__title">${t("maintenance.detail.serviceHistoryTitle")}</h2>
        ${serviceRows ? `<ul class="history__list">${serviceRows}</ul>` : `<p class="history__empty">${t("maintenance.detail.noServiceHistory")}</p>`}
      </section>
    `
    : "";
  const inspectionSection = showInspections
    ? `
      <section class="card history">
        <h2 class="card__title">${t("maintenance.detail.inspectionHistoryTitle")}</h2>
        ${inspectionRows ? `<ul class="history__list">${inspectionRows}</ul>` : `<p class="history__empty">${t("maintenance.detail.noInspectionHistory")}</p>`}
      </section>
    `
    : "";

  return `
    ${serviceSection}
    ${inspectionSection}
  `;
}

/* --- Record service / inspection forms (§35–§36) --- */

function defaultRecordOdometer(): number | null {
  const current = getCurrentOdometer(store.get());
  return current ? current.odometer : null;
}

function findServiceRecord(recordId: string | null): ServiceRecord | null {
  if (!recordId) return null;
  return store.get().serviceHistory.find((r) => r.id === recordId) ?? null;
}

function findInspectionRecord(recordId: string | null): InspectionRecord | null {
  if (!recordId) return null;
  return store.get().inspectionHistory.find((r) => r.id === recordId) ?? null;
}

function recordServiceFormHtml(): string {
  const form = state.recordForm;
  const record = form?.kind === "service" ? findServiceRecord(form.recordId) : null;
  const isEdit = record != null;
  const defaultKm = defaultRecordOdometer();

  return `
    <section class="card">
      <form id="record-form" class="form" novalidate>
        <div class="form__title">${isEdit ? t("maintenance.record.serviceEditTitle") : t("maintenance.record.serviceTitle")}</div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="record-date">${t("maintenance.record.dateLabel")}</label>
            ${dateFieldHtml({
              fieldId: "record-date",
              name: "date",
              value: record?.date ?? todayIso(),
              label: t("maintenance.record.dateLabel"),
            })}
            <p class="field__error" id="record-error-date" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="record-odometer">${t("maintenance.record.odometerLabel")} (${t("common.kmUnit")})</label>
            <input class="field__input" id="record-odometer" name="odometer" type="number"
              inputmode="numeric" min="0" step="1" value="${record?.odometer ?? defaultKm ?? ""}" />
            <p class="field__error" id="record-error-odometer" hidden></p>
            <p class="field__hint">${t("maintenance.record.odometerHint")}</p>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="record-cost">${t("maintenance.record.costLabel")}</label>
          <input class="field__input" id="record-cost" name="cost" type="number"
            inputmode="decimal" min="0" step="any" value="${record?.cost ?? ""}" />
          <p class="field__hint">${t("maintenance.record.costHint")}</p>
          <p class="field__error" id="record-error-cost" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="record-notes">${t("maintenance.record.notesLabel")}</label>
          <textarea class="field__input" id="record-notes" name="notes" rows="2"
            placeholder="${t("maintenance.record.notesPlaceholder")}">${record ? escHtml(record.notes) : ""}</textarea>
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-cancel-record">${t("maintenance.record.cancel")}</button>
          <button type="submit" class="btn btn--filled">${t("maintenance.record.save")}</button>
        </div>
      </form>
    </section>
  `;
}

function recordInspectionFormHtml(): string {
  const form = state.recordForm;
  const record = form?.kind === "inspection" ? findInspectionRecord(form.recordId) : null;
  const isEdit = record != null;
  const defaultKm = defaultRecordOdometer();
  const conditionOptions = CONDITION_OPTIONS.map(
    (option) => `
      <option value="${option.value}" ${record?.condition === option.value ? "selected" : ""}>${t(option.key)}</option>
    `,
  ).join("");

  return `
    <section class="card">
      <form id="record-form" class="form" novalidate>
        <div class="form__title">${isEdit ? t("maintenance.record.inspectionEditTitle") : t("maintenance.record.inspectionTitle")}</div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="record-date">${t("maintenance.record.dateLabel")}</label>
            ${dateFieldHtml({
              fieldId: "record-date",
              name: "date",
              value: record?.date ?? todayIso(),
              label: t("maintenance.record.dateLabel"),
            })}
            <p class="field__error" id="record-error-date" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="record-odometer">${t("maintenance.record.odometerLabel")} (${t("common.kmUnit")})</label>
            <input class="field__input" id="record-odometer" name="odometer" type="number"
              inputmode="numeric" min="0" step="1" value="${record?.odometer ?? defaultKm ?? ""}" />
            <p class="field__error" id="record-error-odometer" hidden></p>
            <p class="field__hint">${t("maintenance.record.odometerHint")}</p>
          </div>
        </div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="record-condition">${t("maintenance.record.conditionLabel")}</label>
            <select class="field__input" id="record-condition" name="condition">
              <option value="">—</option>
              ${conditionOptions}
            </select>
            <p class="field__error" id="record-error-condition" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="record-measurement">${t("maintenance.record.measurementLabel")}</label>
            <input class="field__input" id="record-measurement" name="measurement" type="number"
              inputmode="decimal" min="0" step="any" value="${record?.measurement ?? ""}" />
            <p class="field__hint">${t("maintenance.record.measurementHint")}</p>
            <p class="field__error" id="record-error-measurement" hidden></p>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="record-notes">${t("maintenance.record.notesLabel")}</label>
          <textarea class="field__input" id="record-notes" name="notes" rows="2">${record ? escHtml(record.notes) : ""}</textarea>
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-cancel-record">${t("maintenance.record.cancel")}</button>
          <button type="submit" class="btn btn--filled">${t("maintenance.record.save")}</button>
        </div>
      </form>
    </section>
  `;
}

/* --- Unified configuration form (§19, §26) --- */

interface FormPrefill {
  name: string;
  category: CatalogCategoryId;
  icon: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  displayMode: DisplayMode;
}

interface FormMeta {
  title: string;
  catalogId: string | null;
  /** Null hides the cancel/back button. */
  cancelLabel: string | null;
  /** False hides the initial-service/inspection section (edit mode). */
  withInitialData: boolean;
  /** Optional non-blocking notice shown under the title (e.g. duplicates). */
  notice?: string;
}

function customFormHtml(): string {
  return itemFormHtml(
    {
      name: "",
      category: "other",
      icon: state.icon,
      intervalKm: null,
      intervalMonths: null,
      displayMode: state.displayMode,
    },
    { title: t("maintenance.customTab"), catalogId: null, cancelLabel: null, withInitialData: true },
  );
}

function configFormHtml(): string {
  const config = state.config;
  if (!config) return "";
  if (config.mode === "edit") {
    const item = store.get().maintenanceItems.find((candidate) => candidate.id === config.itemId);
    if (!item) {
      state.config = null;
      return "";
    }
    return itemFormHtml(
      {
        name: item.name,
        category: item.category as CatalogCategoryId,
        icon: item.icon,
        intervalKm: item.rule.intervalKm,
        intervalMonths: item.rule.intervalMonths,
        displayMode: item.rule.displayMode,
      },
      {
        title: t("maintenance.editTitle"),
        catalogId: item.catalogId,
        cancelLabel: t("common.cancel"),
        withInitialData: false,
      },
    );
  }
  const entry = CATALOG.find((candidate) => candidate.id === config.entryId);
  if (!entry) {
    state.config = null;
    return "";
  }
  // Duplicate activation stays allowed (decision 29) — warn, don't block.
  const duplicates = store
    .get()
    .maintenanceItems.filter((item) => item.active && item.catalogId === entry.id);
  return itemFormHtml(
    {
      name: entry.name.fa,
      category: entry.category,
      icon: entry.icon,
      intervalKm: entry.suggestedKm,
      intervalMonths: entry.suggestedMonths,
      displayMode: "auto",
    },
    {
      title: t("maintenance.addTitle"),
      catalogId: entry.id,
      cancelLabel: t("maintenance.form.back"),
      withInitialData: true,
      notice:
        duplicates.length > 0
          ? `${t("maintenance.form.duplicateNotice")} ${duplicates.map((item) => item.name).join("，")}`
          : undefined,
    },
  );
}

function itemFormHtml(prefill: FormPrefill, meta: FormMeta): string {
  const category = fieldValue("category", prefill.category);
  const categoryOptions = CATEGORIES.map(
    (categoryOption) =>
      `<option value="${categoryOption.id}" ${categoryOption.id === category ? "selected" : ""}>${categoryName(categoryOption.id)}</option>`,
  ).join("");

  const iconChoices = CUSTOM_ICON_CHOICES.map(
    (icon) => `
      <button type="button" class="icon-choice ${state.icon === icon ? "icon-choice--active" : ""}"
        data-icon="${icon}" aria-pressed="${state.icon === icon}" aria-label="${icon}">
        <span data-lucide="${icon}"></span>
      </button>
    `,
  ).join("");

  const displayOptions = DISPLAY_OPTIONS.map(
    (option) => `
      <button type="button" class="segmented__option js-display-option
        ${state.displayMode === option.value ? "segmented__option--active" : ""}"
        data-display="${option.value}" role="radio" aria-checked="${state.displayMode === option.value}">
        ${t(option.key)}
      </button>
    `,
  ).join("");

  const initialDataHtml = meta.withInitialData
    ? state.inspectionBased
      ? inspectionInitialHtml()
      : serviceInitialHtml()
    : "";

  return `
    <section class="card">
      <form id="item-form" class="form" novalidate>
        <div class="form__title">${escHtml(meta.title)}</div>
        ${meta.notice ? `<div class="box box--warn" role="note">${escHtml(meta.notice)}</div>` : ""}
        <div class="field">
          <label class="field__label" for="item-name">${t("maintenance.custom.name")}</label>
          <input class="field__input" id="item-name" name="name" type="text"
            value="${escHtml(fieldValue("name", prefill.name))}" placeholder="${t("maintenance.custom.namePlaceholder")}" />
          <p class="field__error" id="item-error-name" hidden></p>
        </div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="item-category">${t("maintenance.custom.category")}</label>
            <select class="field__input" id="item-category" name="category">
              ${categoryOptions}
            </select>
          </div>
          <div class="field">
            <label class="field__label">${t("maintenance.custom.icon")}</label>
            <div class="icon-picker">${iconChoices}</div>
          </div>
        </div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="item-km">${t("maintenance.custom.intervalKm")} (${t("common.kmUnit")})</label>
            <input class="field__input" id="item-km" name="intervalKm" type="number"
              inputmode="numeric" min="1" step="1"
              value="${escHtml(fieldValue("intervalKm", prefill.intervalKm != null ? String(prefill.intervalKm) : ""))}" />
            <p class="field__error" id="item-error-km" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="item-months">${t("maintenance.custom.intervalMonths")}</label>
            <input class="field__input" id="item-months" name="intervalMonths" type="number"
              inputmode="numeric" min="1" step="1"
              value="${escHtml(fieldValue("intervalMonths", prefill.intervalMonths != null ? String(prefill.intervalMonths) : ""))}" />
            <p class="field__error" id="item-error-months" hidden></p>
          </div>
        </div>
        <label class="field checkbox-field">
          <input type="checkbox" name="inspectionBased" id="item-inspection"
            ${state.inspectionBased ? "checked" : ""} />
          <span>${t("maintenance.custom.inspectionBased")}</span>
        </label>
        <p class="field__error" id="item-error-rule" hidden></p>

        <div class="field">
          <label class="field__label">${t("maintenance.form.displayMode")}</label>
          <div class="segmented" role="radiogroup" aria-label="${t("maintenance.form.displayMode")}">
            ${displayOptions}
          </div>
        </div>

        ${initialDataHtml}

        <div class="form__actions">
          ${meta.cancelLabel ? `<button type="button" class="btn btn--text js-cancel-item-form">${escHtml(meta.cancelLabel)}</button>` : ""}
          <button type="submit" class="btn btn--filled">${t("common.save")}</button>
        </div>
      </form>
    </section>
  `;
}

function serviceInitialHtml(): string {
  return `
    <div class="field">
      <label class="field__label">${t("maintenance.form.initialServiceTitle")}</label>
      <div class="form__grid">
        <div class="field">
          <label class="field__label" for="item-service-date">${t("maintenance.form.lastServiceDate")}</label>
          ${dateFieldHtml({
            fieldId: "item-service-date",
            name: "lastServiceDate",
            value: fieldValue("lastServiceDate"),
            label: t("maintenance.form.lastServiceDate"),
          })}
          <p class="field__error" id="item-error-service-date" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="item-service-odometer">${t("maintenance.form.lastServiceOdometer")} (${t("common.kmUnit")})</label>
          <input class="field__input" id="item-service-odometer" name="lastServiceOdometer" type="number"
            inputmode="numeric" min="0" step="1"
            value="${escHtml(fieldValue("lastServiceOdometer"))}" />
          <p class="field__error" id="item-error-service-odometer" hidden></p>
        </div>
      </div>
      <p class="field__hint">${t("maintenance.form.initialServiceHint")}</p>
    </div>
  `;
}

function inspectionInitialHtml(): string {
  const condition = fieldValue("lastInspectionCondition");
  const conditionOptions = CONDITION_OPTIONS.map(
    (option) =>
      `<option value="${option.value}" ${option.value === condition ? "selected" : ""}>${t(option.key)}</option>`,
  ).join("");
  return `
    <div class="field">
      <label class="field__label">${t("maintenance.form.initialInspectionTitle")}</label>
      <div class="form__grid">
        <div class="field">
          <label class="field__label" for="item-inspection-date">${t("maintenance.form.lastInspectionDate")}</label>
          ${dateFieldHtml({
            fieldId: "item-inspection-date",
            name: "lastInspectionDate",
            value: fieldValue("lastInspectionDate"),
            label: t("maintenance.form.lastInspectionDate"),
          })}
          <p class="field__error" id="item-error-inspection-date" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="item-inspection-condition">${t("maintenance.form.lastInspectionCondition")}</label>
          <select class="field__input" id="item-inspection-condition" name="lastInspectionCondition">
            <option value="">—</option>
            ${conditionOptions}
          </select>
        </div>
      </div>
      <p class="field__hint">${t("maintenance.form.initialInspectionHint")}</p>
    </div>
  `;
}

/* --- Events --- */

function bind(container: HTMLElement): void {
  bindDateFields(container);
  bindListEvents(container);
  bindDetailEvents(container);
  bindFormEvents(container);
  bindRecordFormEvents(container);
}

/** Events on the list page (tabs, catalog, sort, item actions). */
function bindListEvents(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>(".js-tab-catalog, .js-tab-custom").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab === "custom" ? "custom" : "catalog";
      redraw(container);
    });
  });

  const searchInput = container.querySelector<HTMLInputElement>(".js-catalog-search");
  searchInput?.addEventListener("input", () => {
    const position = searchInput.selectionStart ?? searchInput.value.length;
    state.search = searchInput.value;
    redraw(container);
    const next = container.querySelector<HTMLInputElement>(".js-catalog-search");
    next?.focus();
    next?.setSelectionRange(position, position);
  });

  container.querySelectorAll<HTMLButtonElement>(".js-add-catalog-item").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = CATALOG.find((candidate) => candidate.id === button.dataset.id);
      if (!entry) return;
      state.config = { mode: "catalog-add", entryId: entry.id };
      state.icon = entry.icon;
      state.displayMode = "auto";
      state.inspectionBased = entry.inspectionBased;
      state.formValues = {};
      redraw(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".js-sort-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.sort = button.dataset.sort === "name" ? "name" : "urgency";
      redraw(container);
    });
  });
}

/** Events on the detail page: record buttons, lifecycle, edit, back. */
function bindDetailEvents(container: HTMLElement): void {
  const currentItemId = maintenanceItemIdFromHash(window.location.hash);

  container.querySelectorAll<HTMLButtonElement>(".js-record-service").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordForm = { kind: "service", recordId: null, itemId: button.dataset.id ?? currentItemId ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-record-inspection").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordForm = { kind: "inspection", recordId: null, itemId: button.dataset.id ?? currentItemId ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-cancel-record").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordForm = null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-edit-record").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind === "inspection" ? "inspection" : "service";
      state.recordForm = { kind, recordId: button.dataset.id ?? null, itemId: currentItemId ?? "" };
      redraw(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".js-edit-item").forEach((button) => {
    button.addEventListener("click", () => {
      const item = store.get().maintenanceItems.find((candidate) => candidate.id === button.dataset.id);
      if (!item) return;
      state.config = { mode: "edit", itemId: item.id };
      state.icon = item.icon;
      state.displayMode = item.rule.displayMode;
      state.inspectionBased = item.rule.inspectionBased;
      state.formValues = {};
      redraw(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".js-deactivate-item").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.id;
      store.update((draft) => {
        const item = draft.maintenanceItems.find((candidate) => candidate.id === itemId);
        if (item) {
          item.active = false;
          item.updatedAt = new Date().toISOString();
        }
      });
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".js-reactivate-item").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.id;
      store.update((draft) => {
        const item = draft.maintenanceItems.find((candidate) => candidate.id === itemId);
        if (item) {
          item.active = true;
          item.updatedAt = new Date().toISOString();
        }
      });
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".js-arm-delete").forEach((button) => {
    button.addEventListener("click", () => {
      state.deleteArmedId = button.dataset.id ?? null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-cancel-delete").forEach((button) => {
    button.addEventListener("click", () => {
      state.deleteArmedId = null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-confirm-delete").forEach((button) => {
    button.addEventListener("click", () => {
      deleteItemPermanently(button.dataset.id ?? null);
    });
  });
}

/** Removes the item AND its history records (§32 delete). Navigates back to the list. */
function deleteItemPermanently(itemId: string | null): void {
  if (!itemId) return;
  state.deleteArmedId = null;
  state.config = null;
  state.recordForm = null;
  store.update((draft) => {
    draft.maintenanceItems = draft.maintenanceItems.filter((item) => item.id !== itemId);
    draft.serviceHistory = draft.serviceHistory.filter((record) => record.maintenanceItemId !== itemId);
    draft.inspectionHistory = draft.inspectionHistory.filter((record) => record.maintenanceItemId !== itemId);
  });
  // If we were on the deleted item's detail page, leave it.
  if (maintenanceItemIdFromHash(window.location.hash) === itemId) {
    window.location.hash = "#/maintenance";
  }
}

/** Events shared by list/detail item-form (config form + record form submit). */
function bindFormEvents(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>(".icon-choice").forEach((button) => {
    button.addEventListener("click", () => {
      state.icon = button.dataset.icon ?? state.icon;
      redraw(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".js-display-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.displayMode = (button.dataset.display as DisplayMode) ?? "auto";
      redraw(container);
    });
  });

  const itemForm = container.querySelector<HTMLFormElement>("#item-form");
  itemForm?.addEventListener("input", captureItemFormValue);
  itemForm?.addEventListener("change", captureItemFormValue);

  container.querySelector<HTMLInputElement>("#item-inspection")?.addEventListener("change", (event) => {
    state.inspectionBased = (event.currentTarget as HTMLInputElement).checked;
    redraw(container);
  });

  container.querySelector<HTMLButtonElement>(".js-cancel-item-form")?.addEventListener("click", () => {
    state.config = null;
    state.formValues = {};
    redraw(container);
  });

  container.querySelector<HTMLFormElement>("#item-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitItemForm(container, event.currentTarget as HTMLFormElement);
  });
}

function bindRecordFormEvents(container: HTMLElement): void {
  const form = container.querySelector<HTMLFormElement>("#record-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitRecordForm(container, form);
  });
}

/** Reads + validates + persists the record form (service or inspection). */
function submitRecordForm(container: HTMLElement, form: HTMLFormElement): void {
  const recordForm = state.recordForm;
  if (!recordForm) return;
  const itemId = maintenanceItemIdFromHash(window.location.hash);
  if (!itemId) return;
  const item = store.get().maintenanceItems.find((candidate) => candidate.id === itemId);
  if (!item) return;

  const data = new FormData(form);
  const date = String(data.get("date") ?? "");
  const kmRaw = String(data.get("odometer") ?? "").trim();
  const odometer = kmRaw === "" ? null : Number(toLatinDigits(kmRaw));
  const notes = String(data.get("notes") ?? "").trim();

  if (recordForm.kind === "service") {
    const costRaw = String(data.get("cost") ?? "").trim();
    const cost = costRaw === "" ? null : Number(toLatinDigits(costRaw));
    const errors = validateServiceRecordEntry({ date, odometer, cost }, { today: todayIso() });
    if (errors.length > 0) {
      showRecordErrors(container, errors.map((error) => [error, t(SERVICE_ERROR_KEYS[error])]));
      return;
    }
    // Clear local state BEFORE the store update (decision 27).
    state.recordForm = null;
    const now = new Date().toISOString();
    store.update((draft) => {
      const recordId = recordForm.recordId;
      if (recordId) {
        const record = draft.serviceHistory.find((r) => r.id === recordId);
        if (record) {
          record.date = date;
          record.odometer = odometer;
          record.cost = cost;
          record.notes = notes;
          return;
        }
      }
      draft.serviceHistory.push({ id: createId(), maintenanceItemId: itemId, date, odometer, notes, cost, createdAt: now });
    });
    return;
  }

  // Inspection event
  const condition = (String(data.get("condition") ?? "") || null) as InspectionCondition | null;
  const measurementRaw = String(data.get("measurement") ?? "").trim();
  const measurement = measurementRaw === "" ? null : Number(toLatinDigits(measurementRaw));
  const errors = validateInspectionRecordEntry(
    { date, odometer, condition, measurement },
    { today: todayIso() },
  );
  if (errors.length > 0) {
    showRecordErrors(
      container,
      errors.map((error) => [error, t(INSPECTION_ERROR_KEYS[error])]),
    );
    return;
  }
  state.recordForm = null;
  const now = new Date().toISOString();
  store.update((draft) => {
    const recordId = recordForm.recordId;
    if (recordId) {
      const record = draft.inspectionHistory.find((r) => r.id === recordId);
      if (record) {
        record.date = date;
        record.odometer = odometer;
        record.condition = condition;
        record.measurement = measurement;
        record.notes = notes;
        return;
      }
    }
    draft.inspectionHistory.push({
      id: createId(),
      maintenanceItemId: itemId,
      date,
      odometer,
      condition,
      measurement,
      notes,
      createdAt: now,
    });
  });
}

function showRecordErrors(container: HTMLElement, errors: [ServiceRecordError | InspectionRecordError, string][]): void {
  for (const [error, message] of errors) {
    const fieldId =
      error === "invalidOdometer"
        ? "record-error-odometer"
        : error === "invalidCost"
          ? "record-error-cost"
          : error === "invalidMeasurement"
            ? "record-error-measurement"
            : error === "conditionRequired"
              ? "record-error-condition"
              : "record-error-date";
    const element = container.querySelector<HTMLElement>(`#${fieldId}`);
    if (element) {
      element.textContent = message;
      element.hidden = false;
    }
  }
}

function submitItemForm(container: HTMLElement, form: HTMLFormElement): void {
  const data = new FormData(form);
  const kmRaw = String(data.get("intervalKm") ?? "").trim();
  const monthsRaw = String(data.get("intervalMonths") ?? "").trim();

  const draft: ItemDraft = {
    name: String(data.get("name") ?? "").trim(),
    category: (String(data.get("category") ?? "other") || "other") as CatalogCategoryId,
    icon: state.icon,
    intervalKm: kmRaw === "" ? null : Number(toLatinDigits(kmRaw)),
    intervalMonths: monthsRaw === "" ? null : Number(toLatinDigits(monthsRaw)),
    inspectionBased: data.get("inspectionBased") === "on",
    displayMode: state.displayMode,
  };

  const errors = validateItemDraft(draft);

  const isEdit = state.config?.mode === "edit";
  const initialErrors: InitialDataError[] = isEdit
    ? []
    : draft.inspectionBased
      ? validateInitialInspection(
          {
            date: String(data.get("lastInspectionDate") ?? ""),
            condition: (String(data.get("lastInspectionCondition") ?? "") ||
              null) as InspectionCondition | null,
          },
          todayIso(),
        )
      : validateInitialService(
          {
            date: String(data.get("lastServiceDate") ?? ""),
            odometer: (() => {
              const raw = String(data.get("lastServiceOdometer") ?? "").trim();
              return raw === "" ? null : Number(toLatinDigits(raw));
            })(),
          },
          todayIso(),
        );

  if (errors.length > 0 || initialErrors.length > 0) {
    showItemErrors(container, errors, initialErrors, draft.inspectionBased);
    return;
  }

  const now = new Date().toISOString();

  if (state.config?.mode === "edit") {
    const itemId = state.config.itemId;
    // Clear local state BEFORE the store update: the notify-driven re-render
    // must show the closed form (decision 27).
    state.config = null;
    state.formValues = {};
    store.update((draftData) => {
      const item = draftData.maintenanceItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      item.name = draft.name;
      item.category = draft.category;
      item.icon = draft.icon;
      item.rule = {
        intervalKm: draft.intervalKm,
        intervalMonths: draft.intervalMonths,
        trigger: "any",
        displayMode: draft.displayMode,
        inspectionBased: draft.inspectionBased,
      };
      item.updatedAt = now;
    });
    return;
  }

  const catalogId = state.config?.mode === "catalog-add" ? state.config.entryId : null;
  const itemId = createId();
  // See above: clear local state before the store update.
  state.config = null;
  state.formValues = {};
  store.update((draftData) => {
    const item = buildItem(draft, { catalogId, now, id: itemId });
    draftData.maintenanceItems.push(item);
    if (draft.inspectionBased) {
      const inspectionDate = String(data.get("lastInspectionDate") ?? "");
      if (inspectionDate !== "") {
        draftData.inspectionHistory.push({
          id: createId(),
          maintenanceItemId: itemId,
          date: inspectionDate,
          odometer: null,
          condition: (String(data.get("lastInspectionCondition") ?? "") ||
            null) as InspectionCondition | null,
          measurement: null,
          notes: "",
          createdAt: now,
        });
      }
    } else {
      const serviceDate = String(data.get("lastServiceDate") ?? "");
      if (serviceDate !== "") {
        const rawOdometer = String(data.get("lastServiceOdometer") ?? "").trim();
        draftData.serviceHistory.push({
          id: createId(),
          maintenanceItemId: itemId,
          date: serviceDate,
          odometer: rawOdometer === "" ? null : Number(toLatinDigits(rawOdometer)),
          notes: "",
          cost: null,
          createdAt: now,
        });
      }
    }
  });
}

function showItemErrors(
  container: HTMLElement,
  draftErrors: ItemDraftError[],
  initialErrors: InitialDataError[],
  inspectionBased: boolean,
): void {
  for (const error of draftErrors) {
    const element = container.querySelector<HTMLElement>(`#${DRAFT_ERROR_FIELD[error]}`);
    if (element) {
      element.textContent = t(DRAFT_ERROR_KEYS[error]);
      element.hidden = false;
    }
  }
  for (const error of initialErrors) {
    const field = inspectionBased ? "item-error-inspection-date" : "item-error-service-date";
    const element = container.querySelector<HTMLElement>(`#${field}`);
    if (element) {
      element.textContent = t(INITIAL_ERROR_KEYS[error]);
      element.hidden = false;
    }
  }
  // Odometer errors always target the service odometer field.
  if (initialErrors.includes("invalidOdometer")) {
    const element = container.querySelector<HTMLElement>("#item-error-service-odometer");
    if (element) {
      element.textContent = t(INITIAL_ERROR_KEYS.invalidOdometer);
      element.hidden = false;
    }
  }
}

/** Re-renders without notifying the store (view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = maintenanceViewHtml();
  bind(container);
  applyIcons();
}
