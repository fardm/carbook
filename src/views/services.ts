import { CATALOG, catalogEntry, categoryName } from "../catalog";
import { lastInspectionFor, lastServiceFor } from "../domain/baselines";
import { diffDays } from "../domain/calendar/dates";
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
import { calculateMaintenance, contextForVehicle, todayIso } from "../domain/maintenance";
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
  InspectionRecord,
  MaintenanceItem,
  ServiceRecord,
} from "../domain/types";
import { t, type MessageKey } from "../i18n";
import { store } from "../state/store";
import { googleCalendarUrl } from "../ui/calendar";
import { bindDateFields, dateFieldHtml } from "../ui/date-field";
import { escHtml } from "../ui/escape";
import { alignFabBar } from "../ui/fab";
import { faNum, formatDate, toLatinDigits } from "../ui/format";
import { applyIcons, CUSTOM_ICON_CHOICES, STATUS_ICONS } from "../ui/icons";
import {
  compareByUrgency,
  dueDateText,
  primaryMetricText,
  resolvePrimaryMetric,
  secondaryMetricText,
  statusLabel,
  type PrimaryMetricKind,
} from "../ui/maintenance-display";
import {
  maintenanceDetailHash,
  maintenanceItemIdFromHash,
  servicesVehicleIdFromHash,
} from "../ui/router";

/**
 * Services view — the vehicle-scoped service list ("سرویس ها").
 *
 * Flow:
 * - The page shows the vehicle selector + one primary action (ثبت سرویس).
 * - ثبت سرویس opens a modal of service-type cards (catalog icons/titles,
 *   plus a دلخواه card). Picking a type opens the service form.
 * - The form saves a service bound to the selected vehicle: title (auto from
 *   the type, editable), icon, replacement (تاریخ تعویض / کیلومتر تعویض),
 *   part life (مدت زمان / کیلومتر) and the calculation mode
 *   (خودکار / کیلومتر / زمان / هردو → DisplayMode).
 * - Active services render as cards with a donut of the remaining part life;
 *   clicking a card opens the per-service detail page (status overview,
 *   explanation, service/inspection history, record/edit events, lifecycle).
 */

/* --- View state --- */

interface RecordFormState {
  kind: "service" | "inspection";
  recordId: string | null;
  itemId: string;
}

interface ServicesViewState {
  /** Vehicle selected on the list page (default/param fallbacks apply). */
  selectedVehicleId: string | null;
  /** Service-type picker modal is open. */
  pickerOpen: boolean;
  /** The add/edit service form modal. */
  form: { mode: "add"; catalogId: string | null } | { mode: "edit"; itemId: string } | null;
  /** Icon grid inside the form modal. */
  iconPickerOpen: boolean;
  /** Current icon + display-mode choices (survive re-renders). */
  icon: string;
  displayMode: DisplayMode;
  /** Typed form values keyed by input name — survives re-renders. */
  formValues: Record<string, string>;
  /** Open record form (add/edit service or inspection) on the detail page. */
  recordForm: RecordFormState | null;
  /** Open record-details (cost/notes…) popover on the detail page. */
  recordDetails: { kind: "service" | "inspection"; recordId: string } | null;
  /** Open three-dot menu on a history row (dropdown popover). */
  recordMenu: { kind: "service" | "inspection"; recordId: string } | null;
  /** History record pending deletion (dedicated confirm modal). */
  recordDeleteConfirm: { kind: "service" | "inspection"; recordId: string } | null;
  /** Item pending deletion (dedicated confirm modal, detail header). */
  deleteConfirmId: string | null;
  /** Item armed for permanent deletion (legacy inline confirm, list page). */
  deleteArmedId: string | null;
}

const state: ServicesViewState = {
  selectedVehicleId: null,
  pickerOpen: false,
  form: null,
  iconPickerOpen: false,
  icon: "wrench",
  displayMode: "auto",
  formValues: {},
  recordForm: null,
  recordDetails: null,
  recordMenu: null,
  recordDeleteConfirm: null,
  deleteConfirmId: null,
  deleteArmedId: null,
};

/** Typed form-field value that survives re-renders (decision 31). */
function fieldValue(field: string, fallback: string = ""): string {
  return state.formValues[field] ?? fallback;
}

/** Keeps typed form fields in state so redraws never wipe them. */
function captureFormValue(event: Event): void {
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

const DRAFT_ERROR_IDS: Record<ItemDraftError, string> = {
  nameRequired: "service-error-name",
  kmInvalid: "service-error-km",
  monthsInvalid: "service-error-months",
  ruleRequired: "service-error-rule",
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

/** Icon choices shown in the form's picker: custom choices + catalog icons. */
const SERVICE_ICON_CHOICES: readonly string[] = [
  ...new Set([...CUSTOM_ICON_CHOICES, ...CATALOG.map((entry) => entry.icon)]),
];

export function renderServices(container: HTMLElement): () => void {
  const draw = (): void => {
    activeContainer = container;
    container.innerHTML = servicesViewHtml();
    bind(container);
    applyIcons();
    alignFabBar();
  };
  registerGlobalKeys();
  draw();
  return store.subscribe(draw);
}

/* --- Top-level branch: list page → detail page (+ modals) --- */

function servicesViewHtml(): string {
  const itemId = maintenanceItemIdFromHash(window.location.hash);
  const detail = itemId ? itemDetailPageHtml(itemId) : servicesListHtml();
  const fab = fabBarHtml(itemId);
  const overlay = state.pickerOpen
    ? typePickerModalHtml()
    : state.form
      ? serviceFormModalHtml() + (state.iconPickerOpen ? iconPickerModalHtml() : "")
      : state.recordForm
        ? recordFormModalHtml()
        : state.recordDetails
          ? recordDetailsModalHtml()
          : state.recordDeleteConfirm
            ? recordDeleteConfirmModalHtml()
            : state.deleteConfirmId
              ? deleteConfirmModalHtml()
              : "";
  return `
    <div class="view-stack view-stack--fab">
      ${detail}
      ${fab}
      ${overlay}
    </div>
  `;
}

/**
 * Floating bottom action bar. On the list page it is the single ثبت سرویس
 * action (hidden when no vehicles exist — that state has its own CTA). On a
 * service's detail page it groups the primary record action with the
 * "افزودن به تقویم گوگل" link; legacy inactive items keep only the body
 * reactivate flow.
 */
function fabBarHtml(itemId: string | null): string {
  const dataset = store.get();
  if (itemId) {
    const item = dataset.maintenanceItems.find((c) => c.id === itemId);
    if (!item || !item.active) return "";
    const calc = calculateMaintenance(item, contextForVehicle(dataset, item.vehicleId));
    const recordLabel = item.rule.inspectionBased
      ? t("maintenance.record.inspectionTitle")
      : t("maintenance.detail.replaceService");
    const recordClass = item.rule.inspectionBased ? "js-record-inspection" : "js-record-service";
    const recordButtonHtml = `
      <button type="button" class="btn btn--filled ${recordClass}" data-id="${escHtml(item.id)}">
        <span data-lucide="refresh-cw"></span>
        ${recordLabel}
      </button>`;
    const calendarHref = calendarEventHref(item, calc);
    const calendarLink = calendarHref
      ? `
      <a class="btn btn--secondary" href="${escHtml(calendarHref)}" target="_blank" rel="noopener noreferrer">
        <span data-lucide="bell"></span>
        ${t("maintenance.detail.reminder")}
      </a>`
      : "";
    const inner = calendarHref
      ? `<div class="fab-bar__group">${recordButtonHtml}${calendarLink}</div>`
      : recordButtonHtml;
    return `<div class="fab-bar">${inner}</div>`;
  }
  if (dataset.vehicles.length === 0) return "";
  return `
    <div class="fab-bar">
      <button type="button" class="btn btn--filled js-add-service">
        <span data-lucide="plus"></span>
        ${t("services.addServiceNew")}
      </button>
    </div>
  `;
}

/* --- Vehicle resolution --- */

/** Selected vehicle: view selection → URL param → default → first vehicle. */
function resolveSelectedVehicleId(dataset: ReturnType<typeof store.get>): string | null {
  if (state.selectedVehicleId && dataset.vehicles.some((v) => v.id === state.selectedVehicleId)) {
    return state.selectedVehicleId;
  }
  const param = servicesVehicleIdFromHash(window.location.hash);
  if (param && dataset.vehicles.some((v) => v.id === param)) return param;
  const defaultId = dataset.settings.defaultVehicleId;
  if (defaultId && dataset.vehicles.some((v) => v.id === defaultId)) return defaultId;
  return dataset.vehicles[0]?.id ?? null;
}


/* --- Services list page --- */

function servicesListHtml(): string {
  const dataset = store.get();
  const vehicleId = resolveSelectedVehicleId(dataset);
  const items = dataset.maintenanceItems.filter((item) => item.vehicleId === vehicleId);
  const active = items.filter((item) => item.active);
  const inactive = items.filter((item) => !item.active);

  const toolbar = servicesToolbarHtml(dataset, vehicleId);
  const body =
    dataset.vehicles.length === 0
      ? servicesNoVehicleHtml()
      : active.length === 0 && inactive.length === 0
        ? servicesEmptyHtml()
        : `
        <div class="services-grid">
          ${sortedActive(active, dataset).map((item) => serviceCardHtml(item, dataset)).join("")}
        </div>
        ${inactive.length > 0 ? inactiveItemsSectionHtml(inactive) : ""}
      `;

  return `
    <h1 class="view-title">${t("view.maintenance.title")}</h1>
    ${toolbar}
    ${body}
  `;
}

function servicesToolbarHtml(dataset: ReturnType<typeof store.get>, selectedId: string | null): string {
  const options = dataset.vehicles
    .map(
      (vehicle) =>
        `<option value="${escHtml(vehicle.id)}" ${vehicle.id === selectedId ? "selected" : ""}>${escHtml(vehicle.name)}</option>`,
    )
    .join("");
  const select = `
    <div class="field services-toolbar__select">
      <label class="field__label" for="services-vehicle-select">${t("services.vehicleLabel")}</label>
      <select class="field__input js-vehicle-select" id="services-vehicle-select"
        ${dataset.vehicles.length === 0 ? "disabled" : ""}>
        ${options}
      </select>
    </div>
  `;
  // The ثبت سرویس action lives in the floating bottom action bar (see
  // fabBarHtml); the toolbar only carries the vehicle selector.
  return `<div class="services-toolbar">${select}</div>`;
}

function servicesNoVehicleHtml(): string {
  return `
    <section class="card services-empty">
      <span class="services-empty__icon" data-lucide="car-front"></span>
      <p class="services-empty__text">${t("services.noVehicles")}</p>
      <a class="btn btn--filled" href="#/vehicle">${t("services.goToVehicles")}</a>
    </section>
  `;
}

function servicesEmptyHtml(): string {
  return `
    <section class="card services-empty">
      <span class="services-empty__icon" data-lucide="wrench"></span>
      <p class="services-empty__text">${t("services.noServices")}</p>
    </section>
  `;
}

/** Active services ordered by urgency (overdue first), then by name. */
function sortedActive(items: MaintenanceItem[], dataset: ReturnType<typeof store.get>): MaintenanceItem[] {
  return [...items].sort((a, b) => {
    const calcA = calculateMaintenance(a, contextForVehicle(dataset, a.vehicleId));
    const calcB = calculateMaintenance(b, contextForVehicle(dataset, b.vehicleId));
    const diff = compareByUrgency(
      { status: calcA.status, remainingPercent: calcA.remainingPercent },
      { status: calcB.status, remainingPercent: calcB.remainingPercent },
    );
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "fa");
  });
}

/* --- Service card (list page) --- */

/** Display lines for a service (no duplicated math — from the engine). */
function itemMetricLines(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): {
  primaryLine: string | null;
  secondaryLine: string | null;
  dateLine: string | null;
  percent: number | null;
  calc: ReturnType<typeof calculateMaintenance>;
  kind: PrimaryMetricKind;
} {
  const calc = calculateMaintenance(item, contextForVehicle(dataset, item.vehicleId));
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
  return {
    primaryLine,
    secondaryLine: secondaryMetricText(calc, kind),
    dateLine: dueDateText(calc, kind),
    percent: calc.remainingPercent,
    calc,
    kind,
  };
}

function serviceCardHtml(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): string {
  const lines = itemMetricLines(item, dataset);
  const last = lastServiceFor(dataset.serviceHistory, item.id);
  const lastLine = last
    ? `${t("services.lastServiceLabel")}: ${formatDate(last.date)}${
        last.odometer != null ? ` — ${faNum(last.odometer)} ${t("common.kmUnit")}` : ""
      }`
    : t("maintenance.detail.neverServiced");

  const metrics =
    lines.primaryLine || lines.secondaryLine || lines.dateLine
      ? `
      <div class="service-card__metrics">
        ${lines.primaryLine ? `<div class="metric metric--primary">${lines.primaryLine}</div>` : ""}
        ${lines.secondaryLine ? `<div class="metric">${lines.secondaryLine}</div>` : ""}
        ${lines.dateLine ? `<div class="metric metric--muted">${lines.dateLine}</div>` : ""}
      </div>`
      : "";

  return `
    <article class="card service-card">
      <a class="service-card__link" href="${maintenanceDetailHash(item.id)}">
        <div class="service-card__head">
          <span class="service-card__icon" data-lucide="${item.icon}"></span>
          <div class="service-card__info">
            <div class="service-card__name">${escHtml(item.name)}</div>
          </div>
          <span class="status-chip status-chip--${lines.calc.status}">
            <span data-lucide="${STATUS_ICONS[lines.calc.status]}"></span>
            ${statusLabel(lines.calc.status)}
          </span>
        </div>
        <div class="service-card__body">
          ${
            lines.percent != null
              ? donutHtml(lines.percent, lines.calc.status, item.name)
              : `<div class="service-card__state" data-lucide="${STATUS_ICONS[lines.calc.status]}"></div>`
          }
          <div class="service-card__detail">
            ${metrics}
            <div class="metric metric--muted service-card__last">${lastLine}</div>
          </div>
        </div>
      </a>
    </article>
  `;
}

/** Inline SVG donut of the remaining life, colored by the status. */
function donutHtml(percent: number, status: string, label: string): string {
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  return `
    <div class="donut donut--${status}" role="img" aria-label="${escHtml(label)}">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="donut__track" cx="50" cy="50" r="42" pathLength="100"></circle>
        <circle class="donut__value" cx="50" cy="50" r="42" pathLength="100"
          stroke-dasharray="${rounded} ${100 - rounded}"></circle>
      </svg>
      <span class="donut__center">${faNum(rounded)}<small>٪</small></span>
    </div>
  `;
}

/* --- Inactive services (lifecycle) --- */

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

/* --- Service-type picker modal --- */

function typePickerModalHtml(): string {
  const typeCards = CATALOG.map(
    (entry) => `
      <button type="button" class="type-card js-pick-type" data-catalog-id="${escHtml(entry.id)}">
        <span class="type-card__icon" data-lucide="${entry.icon}"></span>
        <span class="type-card__name">${escHtml(entry.name.fa)}</span>
      </button>
    `,
  ).join("");
  return `
    <div class="modal-overlay">
      <div class="modal modal--wide modal--type-picker" role="dialog" aria-modal="true"
        aria-label="${t("services.pickTypeTitle")}">
        <div class="form__title">${t("services.pickTypeTitle")}</div>
        <p class="card__text">${t("services.pickTypeHint")}</p>
        <div class="type-grid">
          ${typeCards}
          <button type="button" class="type-card type-card--custom js-pick-type" data-catalog-id="">
            <span class="type-card__icon" data-lucide="wrench"></span>
            <span class="type-card__name">${t("services.customType")}</span>
          </button>
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
        </div>
      </div>
    </div>
  `;
}

/** Icon-choices modal shown on top of the service form (never inline). */
function iconPickerModalHtml(): string {
  const grid = SERVICE_ICON_CHOICES.map(
    (icon) => `
      <button type="button" class="icon-choice js-form-icon-choice ${state.icon === icon ? "icon-choice--active" : ""}"
        data-form-icon="${icon}" aria-pressed="${state.icon === icon}" aria-label="${icon}">
        <span data-lucide="${icon}"></span>
      </button>`,
  ).join("");
  return `
    <div class="modal-overlay" data-overlay="icon-picker">
      <div class="modal modal--wide modal--scroll" role="dialog" aria-modal="true"
        aria-label="${t("services.iconLabel")}">
        <div class="form__title">${t("services.iconLabel")}</div>
        <div class="icon-picker icon-picker--grid">
          ${grid}
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-close-icon-picker">${t("common.cancel")}</button>
        </div>
      </div>
    </div>
  `;
}

/* --- Service form modal (add / edit) --- */

function serviceFormModalHtml(): string {
  const form = state.form;
  if (!form) return "";
  const dataset = store.get();
  const editing = form.mode === "edit";
  const item = editing ? (dataset.maintenanceItems.find((c) => c.id === form.itemId) ?? null) : null;
  const entry = !editing && form.catalogId ? catalogEntry(form.catalogId) : null;

  const prefillKm = editing ? item?.rule.intervalKm ?? null : entry?.suggestedKm ?? null;
  const prefillMonths = editing ? item?.rule.intervalMonths ?? null : entry?.suggestedMonths ?? null;
  const prefillName = editing ? item?.name ?? "" : entry?.name.fa ?? "";
  const title = t(editing ? "maintenance.editTitle" : "services.addService");
  const vehicleId = resolveSelectedVehicleId(dataset);

  const displayOptions = DISPLAY_OPTIONS.map(
    (option) => `
      <button type="button" class="segmented__option js-display-option
        ${state.displayMode === option.value ? "segmented__option--active" : ""}"
        data-display="${option.value}" role="radio" aria-checked="${state.displayMode === option.value}">
        ${t(option.key)}
      </button>
    `,
  ).join("");

  const replacementSection = editing
    ? ""
    : `
    <h3 class="form__section">${t("services.replacementTitle")}</h3>
    <div class="form__grid">
      <div class="field">
        <label class="field__label" for="service-date">${t("services.replacementDate")}</label>
        ${dateFieldHtml({
          fieldId: "service-date",
          name: "serviceDate",
          value: fieldValue("serviceDate", todayIso()),
          label: t("services.replacementDate"),
        })}
        <p class="field__error" id="service-error-date" hidden></p>
      </div>
      <div class="field">
        <label class="field__label" for="service-odometer">${t("services.replacementKm")} (${t("common.kmUnit")})</label>
        <input class="field__input" id="service-odometer" name="serviceOdometer" type="number"
          inputmode="numeric" min="0" step="1" value="${escHtml(fieldValue("serviceOdometer"))}" />
        <p class="field__error" id="service-error-odometer" hidden></p>
      </div>
    </div>
  `;

  return `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
        <form id="service-form" class="form" novalidate>
          <div class="form__title">${escHtml(title)}</div>
          <input type="hidden" name="vehicleId" value="${escHtml(vehicleId ?? "")}" />

          <div class="field">
            <label class="field__label" for="service-name">${t("services.titleLabel")}</label>
            <input class="field__input" id="service-name" name="name" type="text"
              value="${escHtml(fieldValue("name", prefillName))}"
              placeholder="${t("services.titlePlaceholder")}" />
            <p class="field__error" id="service-error-name" hidden></p>
          </div>

          <div class="field">
            <label class="field__label">${t("services.iconLabel")}</label>
            <button type="button" class="icon-btn service-form__icon-toggle js-icon-toggle"
              aria-haspopup="dialog" aria-label="${t("services.iconLabel")}">
              <span data-lucide="${state.icon}"></span>
            </button>
            <p class="field__hint">${t("services.iconPickerHint")}</p>
          </div>

          ${replacementSection}

          <h3 class="form__section">${t("services.lifeTitle")}</h3>
          <div class="form__grid">
            <div class="field">
              <label class="field__label" for="service-months">${t("services.lifeMonths")}</label>
              <input class="field__input" id="service-months" name="intervalMonths" type="number"
                inputmode="numeric" min="1" step="1"
                value="${escHtml(fieldValue("intervalMonths", prefillMonths != null ? String(prefillMonths) : ""))}" />
              <p class="field__error" id="service-error-months" hidden></p>
            </div>
            <div class="field">
              <label class="field__label" for="service-km">${t("services.lifeKm")} (${t("common.kmUnit")})</label>
              <input class="field__input" id="service-km" name="intervalKm" type="number"
                inputmode="numeric" min="1" step="1"
                value="${escHtml(fieldValue("intervalKm", prefillKm != null ? String(prefillKm) : ""))}" />
              <p class="field__error" id="service-error-km" hidden></p>
            </div>
          </div>
          <p class="field__error" id="service-error-rule" hidden></p>

          <div class="field">
            <label class="field__label">${t("services.calculationMode")}</label>
            <div class="segmented" role="radiogroup" aria-label="${t("services.calculationMode")}">
              ${displayOptions}
            </div>
            <p class="field__hint">${t("services.calculationModeHint")}</p>
          </div>

          <div class="form__actions">
            <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
            <button type="submit" class="btn btn--filled">
              ${editing ? t("common.save") : t("services.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

/* --- Detail page (§32–§36): status/calculations + history + record forms --- */

function itemDetailPageHtml(itemId: string): string {
  const dataset = store.get();
  const item = dataset.maintenanceItems.find((candidate) => candidate.id === itemId);
  const back = item?.vehicleId
    ? `#/maintenance?vehicle=${encodeURIComponent(item.vehicleId)}`
    : "#/maintenance";
  if (!item) {
    return `
      <a class="btn btn--text detail-back" href="#/maintenance">${t("maintenance.detail.backToList")}</a>
      <section class="card"><p class="empty-note">${t("maintenance.detail.notFound")}</p></section>
    `;
  }

  const inactive = !item.active;
  const backLink = `<a class="btn btn--text detail-back" href="${back}">${t("maintenance.detail.backToList")}</a>`;

  const overviewHtml = detailOverviewHtml(item, dataset);
  const actionRow = detailActionRowHtml(item, inactive);

  const services = dataset.serviceHistory.filter((r) => r.maintenanceItemId === itemId);
  const inspections = dataset.inspectionHistory.filter((r) => r.maintenanceItemId === itemId);

  const lifetimeRow = detailLifetimeRowHtml(item);

  return `
    ${backLink}
    <section class="card">
      <div class="detail-head">
        <span class="item-list__icon" data-lucide="${item.icon}"></span>
        <div class="detail-head__info">
          <div class="detail-head__title">
            <span class="item-list__name">${escHtml(item.name)}</span>
          </div>
          ${lifetimeRow}
        </div>
        ${detailHeadActionsHtml(item)}
      </div>
      ${actionRow ? `<div class="detail-actions">${actionRow}</div>` : ""}
    </section>
    ${overviewHtml}
    ${detailHistoryHtml(item, services, inspections)}
  `;
}

/** Actions on the detail header, aligned opposite the title: an edit pencil
 * and a delete (trash) icon. The trash opens a dedicated confirmation modal
 * (deleteConfirmModalHtml) — nothing is injected into the page. */
function detailHeadActionsHtml(item: MaintenanceItem): string {
  return `
    <div class="detail-head__actions">
      <button type="button" class="icon-btn js-edit-item" data-id="${escHtml(item.id)}"
        aria-label="${t("maintenance.editItem")}" title="${t("maintenance.editItem")}">
        <span data-lucide="pencil"></span>
      </button>
      <button type="button" class="icon-btn icon-btn--danger js-delete-item" data-id="${escHtml(item.id)}"
        aria-label="${t("maintenance.detail.delete")}" title="${t("maintenance.detail.delete")}">
        <span data-lucide="trash-2"></span>
      </button>
    </div>
  `;
}

/** Body actions under the header — only the legacy inactive-item reactivate
 * flow remains here; the primary record/calendar actions moved to the
 * floating bottom action bar (fabBarHtml). */
function detailActionRowHtml(item: MaintenanceItem, inactive: boolean): string {
  if (!inactive) return "";
  return `
    <button type="button" class="btn btn--filled js-reactivate-item" data-id="${escHtml(item.id)}">
      ${t("maintenance.detail.reactivate")}
    </button>
  `;
}

/** Google Calendar event link for a service (title + next computable date). */
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

/** Lifetime row directly below the service title: the part lifetime the user
 * configured, in kilometers and in time (e.g. ۵٬۰۰۰ کیلومتر · ۶ ماه). */
function detailLifetimeRowHtml(item: MaintenanceItem): string {
  const { intervalKm, intervalMonths } = item.rule;
  const parts: string[] = [];
  if (intervalKm != null) {
    parts.push(`
      <span class="detail-head__lifetime-item">
        <span data-lucide="gauge"></span>
        ${faNum(intervalKm)} ${t("common.kmUnit")}
      </span>`);
  }
  if (intervalMonths != null) {
    parts.push(`
      <span class="detail-head__lifetime-item">
        <span data-lucide="calendar"></span>
        ${faNum(intervalMonths)} ${t("maintenance.monthsUnit")}
      </span>`);
  }
  return parts.length > 0 ? `<div class="detail-head__lifetime">${parts.join("")}</div>` : "";
}

/**
 * Status section: exactly three items — سلامتی (health donut), تاریخ
 * پیشنهادی تعویض (date + remaining time), and کیلومتر پیشنهادی تعویض
 * (mileage + remaining km). All values come from the engine, which combines
 * the user's configured lifetime with the vehicle's current odometer/date.
 */
function detailOverviewHtml(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): string {
  const calc = calculateMaintenance(item, contextForVehicle(dataset, item.vehicleId));
  const percent = calc.remainingPercent;

  const healthBlock =
    percent != null
      ? `
      <div class="health">
        <div class="health__donut">${donutHtml(percent, calc.status, item.name)}</div>
        <div class="health__label">${t("maintenance.detail.health")}</div>
      </div>`
      : "";

  const recommendedDate = calc.estimatedDueDate ?? calc.nextDueDate;
  const dateValue = recommendedDate ? formatDate(recommendedDate) : t("maintenance.detail.notRecorded");
  let dateMeta = "";
  if (recommendedDate) {
    const days = diffDays(recommendedDate, todayIso());
    dateMeta =
      days >= 0
        ? `${faNum(days)} ${t("maintenance.detail.remainingDays")}`
        : `${faNum(-days)} ${t("maintenance.detail.pastDays")}`;
  }

  const dueKm = calc.nextDueOdometer;
  const kmValue = dueKm != null ? faNum(dueKm) : t("maintenance.detail.notRecorded");
  let kmMeta = "";
  if (calc.remainingKm != null) {
    kmMeta =
      calc.remainingKm >= 0
        ? `${faNum(calc.remainingKm)} ${t("maintenance.detail.remainingKm")}`
        : `${faNum(-calc.remainingKm)} ${t("maintenance.detail.pastKm")}`;
  }

  return `
    <section class="card">
      <h2 class="card__title">${t("maintenance.detail.overviewTitle")}</h2>
      <div class="health-grid">
        ${healthBlock}
        <dl class="info-list health-list">
          <div class="info-list__row">
            <dt>${t("maintenance.detail.recommendedDate")}</dt>
            <dd>
              ${escHtml(dateValue)}
              ${dateMeta ? `<span class="info-list__meta">${escHtml(dateMeta)}</span>` : ""}
            </dd>
          </div>
          <div class="info-list__row">
            <dt>${t("maintenance.detail.recommendedKm")}</dt>
            <dd>
              ${escHtml(kmValue)}
              ${kmMeta ? `<span class="info-list__meta">${escHtml(kmMeta)}</span>` : ""}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  `;
}

/** Row actions for a history record: a single three-dot button opening a
 * dropdown popover with the ویرایش / جزئیات / حذف text actions (nothing is
 * injected into the row itself). */
function historyRowActionsHtml(
  kind: "service" | "inspection",
  record: { id: string; date: string; odometer: number | null },
): string {
  const menuOpen =
    state.recordMenu?.kind === kind && state.recordMenu.recordId === record.id;
  return `
    <div class="history__actions">
      <button type="button" class="icon-btn js-record-menu-toggle" data-kind="${kind}" data-id="${escHtml(record.id)}"
        aria-haspopup="menu" aria-expanded="${menuOpen}"
        aria-label="${t("maintenance.detail.recordMenu")}" title="${t("maintenance.detail.recordMenu")}">
        <span data-lucide="more-horizontal"></span>
      </button>
      ${menuOpen ? recordMenuHtml(kind, record.id) : ""}
    </div>
  `;
}

/** Dropdown popover + full-screen click-away backdrop for a record's menu. */
function recordMenuHtml(kind: "service" | "inspection", recordId: string): string {
  return `
    <div class="card-menu__backdrop js-record-menu-backdrop"></div>
    <div class="history-menu" role="menu" aria-label="${t("maintenance.detail.recordMenu")}">
      <button type="button" class="card-menu__item js-record-menu-edit" role="menuitem"
        data-kind="${kind}" data-id="${escHtml(recordId)}">
        <span data-lucide="pencil"></span>
        ${t("maintenance.detail.editRecord")}
      </button>
      <button type="button" class="card-menu__item js-record-menu-info" role="menuitem"
        data-kind="${kind}" data-id="${escHtml(recordId)}">
        <span data-lucide="info"></span>
        ${t("maintenance.detail.recordInfo")}
      </button>
      <div class="card-menu__divider" role="separator"></div>
      <button type="button" class="card-menu__item card-menu__item--danger js-record-menu-delete" role="menuitem"
        data-kind="${kind}" data-id="${escHtml(recordId)}">
        <span data-lucide="trash-2"></span>
        ${t("maintenance.detail.delete")}
      </button>
    </div>
  `;
}

/** Single-row history entry: date first, mileage after, actions at the left. */
function historyRecordRowHtml(
  kind: "service" | "inspection",
  record: { id: string; date: string; odometer: number | null },
): string {
  return `
    <li class="history__item">
      <div class="history__main">
        <span class="history__date">${formatDate(record.date)}</span>
        ${
          record.odometer != null
            ? `<span class="history__km">${faNum(record.odometer)} ${t("common.kmUnit")}</span>`
            : ""
        }
      </div>
      ${historyRowActionsHtml(kind, record)}
    </li>
  `;
}

/** Service + inspection history sections. */
function detailHistoryHtml(
  item: MaintenanceItem,
  services: ServiceRecord[],
  inspections: InspectionRecord[],
): string {
  const serviceRows = sortHistoryNewestFirst(services)
    .map((record) => historyRecordRowHtml("service", record))
    .join("");

  const inspectionRows = sortHistoryNewestFirst(inspections)
    .map((record) => historyRecordRowHtml("inspection", record))
    .join("");

  const showServices = !item.rule.inspectionBased || services.length > 0;
  const showInspections = item.rule.inspectionBased || inspections.length > 0;

  return `
    ${showServices ? `
      <section class="card history">
        <h2 class="card__title">${t("maintenance.detail.serviceHistoryTitle")}</h2>
        ${serviceRows ? `<ul class="history__list">${serviceRows}</ul>` : `<p class="history__empty">${t("maintenance.detail.noServiceHistory")}</p>`}
      </section>` : ""}
    ${showInspections ? `
      <section class="card history">
        <h2 class="card__title">${t("maintenance.detail.inspectionHistoryTitle")}</h2>
        ${inspectionRows ? `<ul class="history__list">${inspectionRows}</ul>` : `<p class="history__empty">${t("maintenance.detail.noInspectionHistory")}</p>`}
      </section>` : ""}
  `;
}

/* --- Record service / inspection forms (detail page) --- */

function defaultRecordOdometer(itemId: string): number | null {
  const dataset = store.get();
  const item = dataset.maintenanceItems.find((candidate) => candidate.id === itemId);
  if (!item?.vehicleId) return null;
  const vehicle = dataset.vehicles.find((v) => v.id === item.vehicleId);
  return vehicle?.currentOdometer ?? null;
}

function findServiceRecord(recordId: string | null): ServiceRecord | null {
  if (!recordId) return null;
  return store.get().serviceHistory.find((r) => r.id === recordId) ?? null;
}

function findInspectionRecord(recordId: string | null): InspectionRecord | null {
  if (!recordId) return null;
  return store.get().inspectionHistory.find((r) => r.id === recordId) ?? null;
}

/** Record add/edit forms live in a modal overlay (never inline on the page). */
function recordFormModalHtml(): string {
  const form = state.recordForm;
  if (!form) return "";
  return form.kind === "service" ? recordServiceFormModalHtml() : recordInspectionFormModalHtml();
}

function recordServiceFormModalHtml(): string {
  const form = state.recordForm;
  const record = form?.kind === "service" ? findServiceRecord(form.recordId) : null;
  const isEdit = record != null;
  const itemId = form?.itemId ?? "";
  const defaultKm = defaultRecordOdometer(itemId);
  const title = isEdit ? t("maintenance.record.serviceEditTitle") : t("maintenance.record.serviceTitle");

  return `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
      <form id="record-form" class="form" novalidate>
        <div class="form__title">${escHtml(title)}</div>
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
      </div>
    </div>
  `;
}

function recordInspectionFormModalHtml(): string {
  const form = state.recordForm;
  const record = form?.kind === "inspection" ? findInspectionRecord(form.recordId) : null;
  const isEdit = record != null;
  const itemId = form?.itemId ?? "";
  const defaultKm = defaultRecordOdometer(itemId);
  const title = isEdit ? t("maintenance.record.inspectionEditTitle") : t("maintenance.record.inspectionTitle");
  const conditionOptions = CONDITION_OPTIONS.map(
    (option) => `
      <option value="${option.value}" ${record?.condition === option.value ? "selected" : ""}>${t(option.key)}</option>
    `,
  ).join("");

  return `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
      <form id="record-form" class="form" novalidate>
        <div class="form__title">${escHtml(title)}</div>
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
      </div>
    </div>
  `;
}

/** Popover showing the full detail of one history record (cost, notes…). */
function recordDetailsModalHtml(): string {
  const details = state.recordDetails;
  if (!details) return "";
  const serviceRecord = details.kind === "service" ? findServiceRecord(details.recordId) : null;
  const inspectionRecord = details.kind === "inspection" ? findInspectionRecord(details.recordId) : null;
  const record = serviceRecord ?? inspectionRecord;
  if (!record) return "";
  const title = t(
    details.kind === "service"
      ? "maintenance.detail.recordInfoServiceTitle"
      : "maintenance.detail.recordInfoInspectionTitle",
  );

  const rows: { label: string; value: string }[] = [];
  rows.push({ label: t("maintenance.record.dateLabel"), value: formatDate(record.date) });
  if (record.odometer != null) {
    rows.push({
      label: t("maintenance.record.odometerLabel"),
      value: `${faNum(record.odometer)} ${t("common.kmUnit")}`,
    });
  }
  if (details.kind === "service" && serviceRecord) {
    if (serviceRecord.cost != null) {
      rows.push({ label: t("maintenance.detail.costLabel"), value: faNum(serviceRecord.cost) });
    }
  } else if (inspectionRecord) {
    if (inspectionRecord.condition) {
      rows.push({
        label: t("maintenance.record.conditionLabel"),
        value: t(`maintenance.condition.${inspectionRecord.condition}` as never),
      });
    }
    if (inspectionRecord.measurement != null) {
      rows.push({
        label: t("maintenance.detail.measurementLabel"),
        value: faNum(inspectionRecord.measurement),
      });
    }
  }
  const notes = record.notes?.trim() ?? "";
  const list = rows
    .map(
      (row) => `
        <div class="info-list__row"><dt>${escHtml(row.label)}</dt><dd>${escHtml(row.value)}</dd></div>
      `,
    )
    .join("");

  return `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
        <div class="form__title">${escHtml(title)}</div>
        ${list ? `<dl class="info-list">${list}</dl>` : ""}
        ${
          notes
            ? `
        <div class="info-list__row">
          <dt>${t("maintenance.record.notesLabel")}</dt>
          <dd class="record-detail__note">${escHtml(notes)}</dd>
        </div>`
            : ""
        }
        <div class="form__actions">
          <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
        </div>
      </div>
    </div>
  `;
}

/** Dedicated confirmation modal for deleting a service (detail header trash). */
function deleteConfirmModalHtml(): string {
  const itemId = state.deleteConfirmId;
  if (!itemId) return "";
  const item = store.get().maintenanceItems.find((candidate) => candidate.id === itemId);
  if (!item) return "";
  return `
    <div class="modal-overlay">
      <div class="modal" role="alertdialog" aria-modal="true" aria-label="${t("maintenance.detail.deleteServiceTitle")}">
        <div class="form">
          <div class="form__title">${t("maintenance.detail.deleteServiceTitle")}</div>
          <div class="box box--danger" role="alert">
            <span data-lucide="triangle-alert"></span>
            <span>${t("maintenance.detail.deleteConfirm")} «${escHtml(item.name)}»</span>
          </div>
          <div class="form__actions">
            <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
            <button type="button" class="btn btn--danger js-confirm-delete" data-id="${escHtml(item.id)}">
              ${t("maintenance.detail.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** Dedicated confirmation modal for deleting a history record. */
function recordDeleteConfirmModalHtml(): string {
  const confirm = state.recordDeleteConfirm;
  if (!confirm) return "";
  return `
    <div class="modal-overlay">
      <div class="modal" role="alertdialog" aria-modal="true" aria-label="${t("maintenance.detail.recordDeleteTitle")}">
        <div class="form">
          <div class="form__title">${t("maintenance.detail.recordDeleteTitle")}</div>
          <div class="box box--danger" role="alert">
            <span data-lucide="triangle-alert"></span>
            <span>${t("maintenance.detail.recordDeleteConfirm")}</span>
          </div>
          <div class="form__actions">
            <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
            <button type="button" class="btn btn--danger js-confirm-record-delete"
              data-kind="${confirm.kind}" data-id="${escHtml(confirm.recordId)}">
              ${t("maintenance.detail.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* --- Events --- */

function bind(container: HTMLElement): void {
  bindDateFields(container);
  bindListEvents(container);
  bindModalEvents(container);
  bindDetailEvents(container);
  bindFormEvents(container);
  bindRecordFormEvents(container);
}

/** Events on the list page (vehicle select, add button, picker). */
function bindListEvents(container: HTMLElement): void {
  container.querySelectorAll<HTMLSelectElement>(".js-vehicle-select").forEach((select) => {
    select.addEventListener("change", () => {
      state.selectedVehicleId = select.value || null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-add-service").forEach((button) => {
    button.addEventListener("click", () => {
      openTypePicker();
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-pick-type").forEach((button) => {
    button.addEventListener("click", () => {
      const catalogId = button.dataset.catalogId ?? null;
      openServiceForm(catalogId);
      redraw(container);
    });
  });
}

/** The container rendered last; used by the global Escape handler. */
let activeContainer: HTMLElement | null = null;

/**
 * Events shared by the modals: انصراف / clicking outside must CLOSE the
 * modal AND re-render (state-only changes would leave stale UI behind —
 * decision 27 pattern).
 */
function bindModalEvents(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target !== overlay) return;
      // The icon picker floats ABOVE the service form: clicking its backdrop
      // (or Esc) only dismisses the picker, never the form underneath.
      if (overlay.dataset.overlay === "icon-picker") {
        state.iconPickerOpen = false;
        redraw(container);
        return;
      }
      closeModals();
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-close-overlay").forEach((button) => {
    button.addEventListener("click", () => {
      closeModals();
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-close-icon-picker").forEach((button) => {
    button.addEventListener("click", () => {
      state.iconPickerOpen = false;
      redraw(container);
    });
  });
}

/** Pressing Esc closes an open modal (unless a date popover is open — that
 * popover owns the key first). Registered once per module load. */
function registerGlobalKeys(): void {
  if (globalKeysBound) return;
  globalKeysBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const datePopoverOpen =
      document.querySelector<HTMLElement>("[data-df-popover]:not([hidden])") != null;
    if (datePopoverOpen) return;
    const container = activeContainer;
    if (!container) return;
    // Topmost modal first: the icon picker closes on its own Esc press; a
    // second Esc then closes the form modal beneath it.
    if (state.iconPickerOpen) {
      state.iconPickerOpen = false;
      redraw(container);
      return;
    }
    // Transient dropdown menus close on their own Esc press.
    if (state.recordMenu) {
      state.recordMenu = null;
      redraw(container);
      return;
    }
    if (
      !(
        state.pickerOpen ||
        state.form ||
        state.recordForm ||
        state.recordDetails ||
        state.recordDeleteConfirm ||
        state.deleteConfirmId
      )
    ) {
      return;
    }
    closeModals();
    redraw(container);
  });
}

let globalKeysBound = false;

function openTypePicker(): void {
  state.pickerOpen = true;
  state.form = null;
  state.formValues = {};
}

function openServiceForm(catalogId: string | null): void {
  state.pickerOpen = false;
  state.form = { mode: "add", catalogId: catalogId === "" ? null : catalogId };
  state.iconPickerOpen = false;
  state.formValues = {};
  const entry = catalogId ? catalogEntry(catalogId) : null;
  state.icon = entry?.icon ?? "wrench";
  state.displayMode = entry?.displayMode ?? "auto";
}

function openEditServiceForm(item: MaintenanceItem): void {
  state.pickerOpen = false;
  state.form = { mode: "edit", itemId: item.id };
  state.iconPickerOpen = false;
  state.formValues = {};
  state.icon = item.icon;
  state.displayMode = item.rule.displayMode;
}

function closeModals(): void {
  state.pickerOpen = false;
  state.form = null;
  state.iconPickerOpen = false;
  state.recordForm = null;
  state.recordDetails = null;
  state.recordMenu = null;
  state.recordDeleteConfirm = null;
  state.deleteConfirmId = null;
  state.deleteArmedId = null;
}

/** Events on the detail page. */
function bindDetailEvents(container: HTMLElement): void {
  const currentItemId = maintenanceItemIdFromHash(window.location.hash);

  container.querySelectorAll<HTMLButtonElement>(".js-record-service, .js-record-inspection").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.classList.contains("js-record-inspection") ? "inspection" : "service";
      state.recordDetails = null;
      state.recordMenu = null;
      state.recordDeleteConfirm = null;
      state.recordForm = { kind, recordId: null, itemId: button.dataset.id ?? currentItemId ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-cancel-record").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordForm = null;
      state.recordDeleteConfirm = null;
      redraw(container);
    });
  });
  /* Three-dot menu on history rows: toggle + click-away backdrop + items. */
  container.querySelectorAll<HTMLButtonElement>(".js-record-menu-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind === "inspection" ? "inspection" : "service";
      const id = button.dataset.id ?? "";
      state.recordMenu =
        state.recordMenu?.kind === kind && state.recordMenu.recordId === id ? null : { kind, recordId: id };
      redraw(container);
    });
  });
  container.querySelector<HTMLElement>(".js-record-menu-backdrop")?.addEventListener("click", () => {
    state.recordMenu = null;
    redraw(container);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-record-menu-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind === "inspection" ? "inspection" : "service";
      state.recordMenu = null;
      state.recordDetails = null;
      state.recordDeleteConfirm = null;
      state.recordForm = { kind, recordId: button.dataset.id ?? null, itemId: currentItemId ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-record-menu-info").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind === "inspection" ? "inspection" : "service";
      state.recordMenu = null;
      state.recordForm = null;
      state.recordDeleteConfirm = null;
      state.recordDetails = { kind, recordId: button.dataset.id ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-record-menu-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind === "inspection" ? "inspection" : "service";
      state.recordMenu = null;
      state.recordForm = null;
      state.recordDetails = null;
      state.recordDeleteConfirm = { kind, recordId: button.dataset.id ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-confirm-record-delete").forEach((button) => {
    button.addEventListener("click", () => {
      deleteRecord(button.dataset.kind === "inspection" ? "inspection" : "service", button.dataset.id ?? "");
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-edit-item").forEach((button) => {
    button.addEventListener("click", () => {
      const item = store.get().maintenanceItems.find((candidate) => candidate.id === button.dataset.id);
      if (!item) return;
      openEditServiceForm(item);
      redraw(container);
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
  container.querySelectorAll<HTMLButtonElement>(".js-delete-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.deleteConfirmId = button.dataset.id ?? null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-confirm-delete").forEach((button) => {
    button.addEventListener("click", () => {
      deleteItemPermanently(button.dataset.id ?? null);
    });
  });
}

/** Removes one history record (service or inspection event). */
function deleteRecord(kind: "service" | "inspection", recordId: string): void {
  if (!recordId) return;
  state.recordDeleteConfirm = null;
  state.recordMenu = null;
  store.update((draft) => {
    if (kind === "service") {
      draft.serviceHistory = draft.serviceHistory.filter((record) => record.id !== recordId);
    } else {
      draft.inspectionHistory = draft.inspectionHistory.filter((record) => record.id !== recordId);
    }
  });
}

/** Removes the item AND its history records. Leaves the detail page if open. */
function deleteItemPermanently(itemId: string | null): void {
  if (!itemId) return;
  state.deleteConfirmId = null;
  state.deleteArmedId = null;
  state.recordForm = null;
  store.update((draft) => {
    draft.maintenanceItems = draft.maintenanceItems.filter((item) => item.id !== itemId);
    draft.serviceHistory = draft.serviceHistory.filter((record) => record.maintenanceItemId !== itemId);
    draft.inspectionHistory = draft.inspectionHistory.filter((record) => record.maintenanceItemId !== itemId);
  });
  if (maintenanceItemIdFromHash(window.location.hash) === itemId) {
    window.location.hash = "#/maintenance";
  }
}

/** Events for the service form modal (icon picker, calc mode, submit). */
function bindFormEvents(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>(".js-icon-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      state.iconPickerOpen = !state.iconPickerOpen;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-form-icon-choice").forEach((button) => {
    button.addEventListener("click", () => {
      state.icon = button.dataset.formIcon ?? state.icon;
      state.iconPickerOpen = false;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-display-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.displayMode = (button.dataset.display as DisplayMode) ?? "auto";
      redraw(container);
    });
  });

  const serviceForm = container.querySelector<HTMLFormElement>("#service-form");
  serviceForm?.addEventListener("input", captureFormValue);
  serviceForm?.addEventListener("change", captureFormValue);
  serviceForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitServiceForm(container, event.currentTarget as HTMLFormElement);
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

/* --- Submit: add/edit service --- */

function submitServiceForm(container: HTMLElement, form: HTMLFormElement): void {
  const serviceForm = state.form;
  if (!serviceForm) return;
  const data = new FormData(form);
  const name = String(data.get("name") ?? "").trim();
  const kmRaw = String(data.get("intervalKm") ?? "").trim();
  const monthsRaw = String(data.get("intervalMonths") ?? "").trim();
  const intervalKm = kmRaw === "" ? null : Number(toLatinDigits(kmRaw));
  const intervalMonths = monthsRaw === "" ? null : Number(toLatinDigits(monthsRaw));
  const editing = serviceForm.mode === "edit";

  if (editing) {
    const item = store.get().maintenanceItems.find((c) => c.id === serviceForm.itemId);
    if (!item) return;
    const draft: ItemDraft = {
      name,
      category: item.category as ItemDraft["category"],
      icon: state.icon,
      intervalKm,
      intervalMonths,
      inspectionBased: item.rule.inspectionBased,
      displayMode: state.displayMode,
    };
    const errors = validateItemDraft(draft);
    if (errors.length > 0) {
      showServiceErrors(container, errors.map((error) => [error, t(DRAFT_ERROR_KEYS[error])]));
      return;
    }
    closeModals();
    store.update((draftData) => {
      const target = draftData.maintenanceItems.find((c) => c.id === item.id);
      if (!target) return;
      target.name = draft.name;
      target.icon = draft.icon;
      target.rule = {
        intervalKm: draft.intervalKm,
        intervalMonths: draft.intervalMonths,
        trigger: "any",
        displayMode: draft.displayMode,
        inspectionBased: draft.inspectionBased,
      };
      target.updatedAt = new Date().toISOString();
    });
    return;
  }

  // Add a new service for the chosen vehicle.
  const entry = serviceForm.catalogId ? catalogEntry(serviceForm.catalogId) : null;
  const inspectionBased = !!entry?.inspectionBased;
  const vehicleId = String(data.get("vehicleId") ?? "") || null;
  const date = String(data.get("serviceDate") ?? "");
  const odometerRaw = String(data.get("serviceOdometer") ?? "").trim();
  const odometer = odometerRaw === "" ? null : Number(toLatinDigits(odometerRaw));

  const draft: ItemDraft = {
    name,
    category: entry?.category ?? "other",
    icon: state.icon,
    intervalKm,
    intervalMonths,
    inspectionBased,
    displayMode: state.displayMode,
  };
  const errors = validateItemDraft(draft);
  const initialErrors = inspectionBased
    ? validateInitialInspection({ date, condition: null }, todayIso())
    : validateInitialService({ date, odometer }, todayIso());

  if (errors.length > 0 || initialErrors.length > 0) {
    showServiceErrors(container, [
      ...errors.map((error): [ItemDraftError | InitialDataError, string] => [error, t(DRAFT_ERROR_KEYS[error])]),
      ...initialErrors.map((error): [ItemDraftError | InitialDataError, string] => [error, t(INITIAL_ERROR_KEYS[error])]),
    ]);
    return;
  }

  const now = new Date().toISOString();
  const itemId = createId();
  const catalogId = entry?.id ?? null;
  closeModals();
  store.update((draftData) => {
    const item = buildItem(draft, { catalogId, now, id: itemId, vehicleId });
    draftData.maintenanceItems.push(item);
    if (date === "") return;
    if (inspectionBased) {
      draftData.inspectionHistory.push({
        id: createId(),
        maintenanceItemId: itemId,
        vehicleId,
        date,
        odometer,
        condition: null,
        measurement: null,
        notes: "",
        createdAt: now,
      });
    } else {
      draftData.serviceHistory.push({
        id: createId(),
        maintenanceItemId: itemId,
        vehicleId,
        date,
        odometer,
        notes: "",
        cost: null,
        createdAt: now,
      });
    }
  });
}

function showServiceErrors(
  container: HTMLElement,
  errors: [ItemDraftError | InitialDataError, string][],
): void {
  for (const [error, message] of errors) {
    const id =
      error in DRAFT_ERROR_IDS
        ? DRAFT_ERROR_IDS[error as ItemDraftError]
        : error === "invalidOdometer"
          ? "service-error-odometer"
          : "service-error-date";
    const element = container.querySelector<HTMLElement>(`#${id}`);
    if (element) {
      element.textContent = message;
      element.hidden = false;
    }
  }
}

/* --- Submit: record service / inspection events (detail page) --- */

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
      draft.serviceHistory.push({
        id: createId(),
        maintenanceItemId: itemId,
        vehicleId: item.vehicleId,
        date,
        odometer,
        notes,
        cost,
        createdAt: now,
      });
    });
    return;
  }

  // Inspection event
  const condition = (String(data.get("condition") ?? "") || null) as InspectionCondition | null;
  const measurementRaw = String(data.get("measurement") ?? "").trim();
  const measurement = measurementRaw === "" ? null : Number(toLatinDigits(measurementRaw));
  const errors = validateInspectionRecordEntry({ date, odometer, condition, measurement }, { today: todayIso() });
  if (errors.length > 0) {
    showRecordErrors(container, errors.map((error) => [error, t(INSPECTION_ERROR_KEYS[error])]));
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
      vehicleId: item.vehicleId,
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

/** Re-renders without notifying the store (view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = servicesViewHtml();
  bind(container);
  applyIcons();
  alignFabBar();
}
