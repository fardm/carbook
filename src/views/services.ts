import { CATALOG, catalogEntry, categoryName, recommendedLifespanKm } from "../catalog";
import { diffDays } from "../domain/calendar/dates";
import { createId } from "../domain/ids";
import {
  buildItem,
  validateInitialService,
  validateItemDraft,
  type InitialDataError,
  type ItemDraft,
  type ItemDraftError,
} from "../domain/item-factory";
import { calculateMaintenance, contextForVehicle, todayIso } from "../domain/maintenance";
import {
  sortHistoryNewestFirst,
  validateServiceRecordEntry,
  type ServiceRecordError,
} from "../domain/records";
import type {
  DisplayMode,
  MaintenanceItem,
  ServiceRecord,
} from "../domain/types";
import { t, type MessageKey } from "../i18n";
import { store } from "../state/store";
import { bindDateFields, dateFieldHtml } from "../ui/date-field";
import { currencyLabel } from "../ui/currency";
import { escHtml } from "../ui/escape";
import { alignFabBar } from "../ui/fab";
import { faNum, formatDate, toLatinDigits } from "../ui/format";
import { bindFloatingFields } from "../ui/floating-field";
import { applyIcons, CUSTOM_ICON_CHOICES, STATUS_ICONS } from "../ui/icons";
import {
  compareByUrgency,
  dueDateText,
  formatLifespanDuration,
  formatRemainingCountdown,
  healthBand,
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
 *   the kilometer-based part lifetime (عمر قطعه) and the calculation mode
 *   (خودکار / کیلومتر / زمان / هردو → DisplayMode).
 * - Active services render as cards with a donut of the remaining part life;
 *   clicking a card opens the per-service detail page (status overview,
 *   explanation, service history, record/edit events, lifecycle).
 */

/* --- View state --- */

interface RecordFormState {
  recordId: string | null;
  itemId: string;
}

interface ServicesViewState {
  /** Vehicle selected on the list page (default/param fallbacks apply). */
  selectedVehicleId: string | null;
  /** Service-type picker modal is open. */
  pickerOpen: boolean;
  /** Live query filtering service-type cards inside the picker. */
  typeQuery: string;
  /** The add/edit service form modal. */
  form: { mode: "add"; catalogId: string | null } | { mode: "edit"; itemId: string } | null;
  /** Icon grid inside the form modal. */
  iconPickerOpen: boolean;
  /** Current icon + display-mode choices (survive re-renders). */
  icon: string;
  displayMode: DisplayMode;
  /** Typed form values keyed by input name — survives re-renders. */
  formValues: Record<string, string>;
  /** Open record form (add/edit service) on the detail page. */
  recordForm: RecordFormState | null;
  /** Open record-details (cost/notes…) popover on the detail page. */
  recordDetails: { recordId: string } | null;
  /** Open three-dot menu on a history row (dropdown popover). */
  recordMenu: { recordId: string } | null;
  /** History record pending deletion (dedicated confirm modal). */
  recordDeleteConfirm: { recordId: string } | null;
  /** Item pending deletion (dedicated confirm modal). */
  deleteConfirmId: string | null;
  /** Item armed for permanent deletion (legacy inline confirm, list page). */
  deleteArmedId: string | null;
  /** Service card whose three-dot menu is open (list + detail). */
  serviceMenuId: string | null;
  /** Service History section on the detail page is expanded. */
  historyOpen: boolean;
}

const state: ServicesViewState = {
  selectedVehicleId: null,
  pickerOpen: false,
  typeQuery: "",
  form: null,
  iconPickerOpen: false,
  icon: "wrench",
  displayMode: "km",
  formValues: {},
  recordForm: null,
  recordDetails: null,
  recordMenu: null,
  recordDeleteConfirm: null,
  deleteConfirmId: null,
  deleteArmedId: null,
  serviceMenuId: null,
  historyOpen: false,
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

/** Health-calculation choices in the service form: only کیلومتر / زمان are
 * offered now (خودکار/هردو were removed). Each carries its own explanation. */
const DISPLAY_OPTIONS: readonly { value: DisplayMode; key: MessageKey; hintKey: MessageKey }[] = [
  { value: "km", key: "maintenance.display.km", hintKey: "services.healthModeKmHint" },
  { value: "time", key: "maintenance.display.time", hintKey: "services.healthModeTimeHint" },
];

/** Maps a stored/legacy display mode onto the two remaining health modes
 * (legacy auto/both behave like کیلومتر for mileage-only parts). */
function healthMode(value: DisplayMode): DisplayMode {
  return value === "km" || value === "time" ? value : "km";
}

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
    bindFloatingFields(container);
    applyTypeFilter(container);
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

    const recordLabel = t("maintenance.detail.replaceService");
    const recordClass = "js-record-service";

    const recordButtonHtml = `
      <button type="button" class="btn btn--filled ${recordClass}" data-id="${escHtml(item.id)}">
        <span data-lucide="refresh-cw"></span>
        ${recordLabel}
      </button>`;

    // Switch to local reminders creation instead of google calendar
    const createReminderHref = `#/reminders?serviceId=${encodeURIComponent(item.id)}&vehicle=${encodeURIComponent(state.selectedVehicleId!)}`;

    const calendarLink = `
      <a class="btn btn--secondary" href="${createReminderHref}">
        <span data-lucide="bell"></span>
        ${t("maintenance.detail.reminder")}
      </a>`;

    const inner = `<div class="fab-bar__group">${recordButtonHtml}${calendarLink}</div>`;
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
  return {
    primaryLine: primaryMetricText(calc, kind),
    secondaryLine: secondaryMetricText(calc, kind),
    dateLine: dueDateText(calc, kind),
    percent: calc.remainingPercent,
    calc,
    kind,
  };
}

function serviceCardHtml(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): string {
  const lines = itemMetricLines(item, dataset);
  const notRecorded = t("maintenance.detail.notRecorded");

  // Recommended NEXT replacement (تعویض بعدی), not the last one: remaining
  // days until the estimated due date and remaining km until the due
  // odometer — the same numbers the detail page's status cards show.
  const recommendedDate = lines.calc.estimatedDueDate ?? lines.calc.nextDueDate;
  let daysValue: string = notRecorded;
  if (recommendedDate) {
    daysValue = formatRemainingCountdown(diffDays(recommendedDate, todayIso()));
  }
  let kmValue: string = notRecorded;
  if (lines.calc.remainingKm != null) {
    kmValue =
      lines.calc.remainingKm >= 0
        ? `${faNum(lines.calc.remainingKm)} ${t("common.kmUnit")} ${t("maintenance.detail.remainingKm")}`
        : `${faNum(-lines.calc.remainingKm)} ${t("common.kmUnit")} ${t("maintenance.detail.pastKm")}`;
  }

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
              ? donutHtml(lines.percent, dataset.settings.statusThresholds, item.name)
              : `<div class="service-card__state" data-lucide="${STATUS_ICONS[lines.calc.status]}"></div>`
          }
          <div class="service-card__detail">
            <div class="service-card__next-label">${t("maintenance.list.nextReplacement")}:</div>
            <div class="metric service-card__last">
              <span data-lucide="calendar"></span>
              ${escHtml(daysValue)}
            </div>
            <div class="metric service-card__last">
              <span data-lucide="gauge"></span>
              ${escHtml(kmValue)}
            </div>
          </div>
        </div>
      </a>
      ${serviceItemMenuHtml(item.id)}
    </article>
  `;
}

/** Inline SVG donut of the remaining life. The ring and the percentage in
 * its center are colored by the SAME three-band health classification
 * (green / orange / red) derived from the rounded percentage via the
 * configured status thresholds. */
function donutHtml(
  percent: number,
  thresholds: { duePercent: number; dueSoonPercent: number },
  label: string,
): string {
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  const band = healthBand(rounded, thresholds);
  return `
    <div class="donut donut--${band}" role="img" aria-label="${escHtml(label)}">
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

/** Search text folded for matching: unifies Persian/Arabic letter variants,
 * drops ZWNJ/RTL marks and whitespace, so «روغن موتور», «روغن‌موتور» and
 * «Brake» queries all hit the catalog names they belong to. */
function normalizeTypeSearch(text: string): string {
  return text
    .replace(/[\u200c-\u200f]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function typePickerModalHtml(): string {
  const query = state.typeQuery;
  const typeCards = CATALOG.map(
    (entry) => `
      <button type="button" class="type-card js-pick-type js-type-card" data-catalog-id="${escHtml(entry.id)}"
        data-search="${escHtml(normalizeTypeSearch(`${entry.name.fa} ${entry.name.en}`))}">
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
        <div class="field type-picker__search">
          <label class="field__label" for="type-search">${t("services.searchLabel")}</label>
          <div class="type-search">
            <input class="field__input type-search__input js-type-search" id="type-search"
              type="search" autocomplete="off" autocapitalize="off" spellcheck="false"
              value="${escHtml(query)}" placeholder="${t("services.searchPlaceholder")}" />
            <button type="button" class="type-search__clear js-type-search-clear"
              ${query === "" ? "hidden" : ""}
              aria-label="${t("services.searchClear")}" title="${t("services.searchClear")}">
              <span data-lucide="x" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="type-grid">
          ${typeCards}
          <div class="type-picker__empty js-type-empty" hidden>
            <span class="type-picker__empty-icon" data-lucide="search" aria-hidden="true"></span>
            <p class="type-picker__empty-text">${t("services.searchEmpty")}</p>
          </div>
          <button type="button" class="type-card type-card--custom js-pick-type js-type-card" data-catalog-id=""
            data-search="${escHtml(normalizeTypeSearch(`${t("services.customType")} custom`))}">
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

/** Hides the type cards that don't match the query and keeps the clear
 * button and empty state in sync. Runs after every render and on each
 * keystroke; it touches presentation only — cards reappear when the query
 * clears and the CATALOG itself is never modified. */
function applyTypeFilter(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>(".js-type-search");
  const query = normalizeTypeSearch(input?.value ?? state.typeQuery);
  let matches = 0;
  container.querySelectorAll<HTMLButtonElement>(".js-type-card").forEach((card) => {
    const hit = query === "" || (card.dataset.search ?? "").includes(query);
    card.hidden = !hit;
    if (hit) matches += 1;
  });
  const grid = container.querySelector<HTMLElement>(".type-grid");
  const empty = container.querySelector<HTMLElement>(".js-type-empty");
  if (grid) grid.classList.toggle("type-grid--no-results", matches === 0);
  if (empty) empty.hidden = matches > 0;
  const clear = container.querySelector<HTMLButtonElement>(".js-type-search-clear");
  if (clear) clear.hidden = query === "";
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
  // Recommendation follows the catalog template (add) or the item's linked
  // catalog id (edit); custom services have none.
  const catalogIdForHint = editing ? item?.catalogId ?? null : form.catalogId;
  const recommendedKm = recommendedLifespanKm(catalogIdForHint);

  // Add mode: lifespan stays empty — user types it or applies the hint.
  // Edit mode: show the item's saved interval only (not the recommendation).
  const prefillKm = editing ? item?.rule.intervalKm ?? null : null;
  const prefillName = editing ? item?.name ?? "" : entry?.name.fa ?? "";
  const title = t(editing ? "maintenance.editTitle" : "services.addService");
  const vehicleId = resolveSelectedVehicleId(dataset);
  // The icon field belongs to custom services only (دلخواه); catalog-based
  // services keep their predefined icon (§37).
  const isCustom = form.mode === "edit" ? (item?.catalogId == null) : form.catalogId == null;
  // Current odometer of the selected vehicle, offered as a quick-fill for
  // «کیلومتر آخرین تعویض»; disabled when no mileage is on record.
  const currentKm = vehicleId
    ? (dataset.vehicles.find((v) => v.id === vehicleId)?.currentOdometer ?? null)
    : null;

  const displayOptions = DISPLAY_OPTIONS.map(
    (option) => `
      <button type="button" class="health-option js-display-option
        ${state.displayMode === option.value ? "health-option--active" : ""}"
        data-display="${option.value}" role="radio" aria-checked="${state.displayMode === option.value}">
        <span class="health-option__indicator" aria-hidden="true"></span>
        <span class="health-option__text">
          <span class="health-option__title">${t(option.key)}</span>
          <span class="health-option__hint">${t(option.hintKey)}</span>
        </span>
      </button>
    `,
  ).join("");

  const replacementSection = editing
    ? ""
    : `
    <div class="field">
      <label class="field__label" for="service-date">${t("services.replacementDate")}</label>
      ${dateFieldHtml({
        fieldId: "service-date",
        name: "serviceDate",
        // Never auto-fill today: the user records the actual replacement
        // date, and an empty field shows the label inside as a placeholder.
        value: fieldValue("serviceDate"),
        label: t("services.replacementDate"),
      })}
      <p class="field__error" id="service-error-date" hidden></p>
    </div>
    <div class="field">
      <label class="field__label" for="service-odometer">${t("services.replacementKm")}</label>
      <div class="affix-field">
        <input class="field__input affix-field__input" id="service-odometer" name="serviceOdometer" type="number"
          inputmode="numeric" min="0" step="1" value="${escHtml(fieldValue("serviceOdometer"))}" />
        <button type="button" class="affix-field__btn js-use-current-km"
          ${currentKm == null ? "disabled" : ""}
          title="${escHtml(t("services.useCurrentKm"))}"
          aria-label="${escHtml(t("services.useCurrentKm"))}">
          <span data-lucide="download" aria-hidden="true"></span>
        </button>
      </div>
      <p class="field__error" id="service-error-odometer" hidden></p>
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

          ${isCustom ? `
          <div class="field">
            <label class="field__label">${t("services.iconLabel")}</label>
            <button type="button" class="icon-btn service-form__icon-toggle js-icon-toggle"
              aria-haspopup="dialog" aria-label="${t("services.iconLabel")}">
              <span data-lucide="${state.icon}"></span>
            </button>
            <p class="field__hint">${t("services.iconPickerHint")}</p>
          </div>` : ""}

          ${replacementSection}

          <div class="field">
            <label class="field__label" for="service-km">${t("services.lifeKm")}</label>
            ${recommendedKm != null ? `
            <div class="affix-field">
              <input class="field__input affix-field__input" id="service-km" name="intervalKm" type="number"
                inputmode="numeric" min="1" step="1"
                value="${escHtml(fieldValue("intervalKm", prefillKm != null ? String(prefillKm) : ""))}" />
              <button type="button" class="affix-field__btn js-use-recommended-km"
                data-recommended-km="${recommendedKm}"
                title="${escHtml(t("services.useRecommendedLifespan"))}"
                aria-label="${escHtml(t("services.useRecommendedLifespan"))}">
                <span data-lucide="download" aria-hidden="true"></span>
              </button>
            </div>
            <p class="field__hint">${t("services.recommendedLifespanHint")} ${faNum(recommendedKm)} ${t("common.kmUnit")}</p>` : `
            <input class="field__input" id="service-km" name="intervalKm" type="number"
              inputmode="numeric" min="1" step="1"
              value="${escHtml(fieldValue("intervalKm", prefillKm != null ? String(prefillKm) : ""))}" />`}
            <p class="field__error" id="service-error-km" hidden></p>
          </div>
          <p class="field__error" id="service-error-rule" hidden></p>

          <div class="field">
            <span class="field__label" id="service-health-mode-label">${t("services.calculationMode")}</span>
            <div class="health-options" role="radiogroup" aria-labelledby="service-health-mode-label">
              ${displayOptions}
            </div>
          </div>

          ${!editing ? `
          <div class="field">
            <label class="field__label" for="service-cost">${t("maintenance.record.costLabel")}</label>
            <input class="field__input" id="service-cost" name="serviceCost" type="number"
              inputmode="decimal" min="0" step="any" value="${escHtml(fieldValue("serviceCost"))}"
              placeholder="${faNum(0)} ${currencyLabel(store.get().settings.currency)}" />
            <p class="field__error" id="service-error-cost" hidden></p>
          </div>` : ""}

          ${!editing ? `
          <div class="field">
            <label class="field__label" for="service-cost">${t("maintenance.record.costLabel")}</label>
            <input class="field__input" id="service-cost" name="serviceCost" type="number"
              inputmode="decimal" min="0" step="any" value="${escHtml(fieldValue("serviceCost"))}"
              placeholder="${faNum(0)} ${currencyLabel(store.get().settings.currency)}" />
            <p class="field__error" id="service-error-cost" hidden></p>
          </div>` : ""}

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

/** The detail item whose page is currently rendered — used to reset the
 * history section's default open state (short histories expand) when
 * switching items. */
let renderedDetailItemId: string | null = null;

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
  const services = dataset.serviceHistory.filter((r) => r.maintenanceItemId === itemId);
  if (renderedDetailItemId !== item.id) {
    renderedDetailItemId = item.id;
    // A short history (≤3 records) stays expanded by default so the empty
    // state or entries are visible; longer lists collapse so the status
    // sections stay readable without scrolling.
    state.historyOpen = services.length <= 3;
  }

  const inactive = !item.active;
  const calc = calculateMaintenance(item, contextForVehicle(dataset, item.vehicleId));
  const backLink = `<a class="btn btn--text detail-back" href="${back}">
    <span data-lucide="arrow-right" aria-hidden="true"></span>
    <span>${t("maintenance.detail.backToList")}</span>
  </a>`;

  // ویرایش / حذف sit opposite the Back link and reuse the exact same
  // handlers as the service cards' menus (js-service-menu-edit / delete).
  const itemActions = `
    <div class="detail-topbar__actions">
      <button type="button" class="btn btn--text js-service-menu-edit" data-id="${escHtml(item.id)}">
        <span data-lucide="pencil"></span>
        ${t("maintenance.editItem")}
      </button>
      <button type="button" class="btn btn--text btn--danger-text js-service-menu-delete"
        data-id="${escHtml(item.id)}">
        <span data-lucide="trash-2"></span>
        ${t("maintenance.detail.delete")}
      </button>
    </div>`;

  return `
    <div class="detail-topbar">
      ${backLink}
      ${itemActions}
    </div>
    <section class="card service-detail-card">
      <div class="service-detail-card__sections">
        <section class="service-detail-card__header">
          <div class="service-detail-card__header-row">
            <div class="service-info">
              <span class="service-info__icon" data-lucide="${item.icon}"></span>
              <div class="service-info__main">
                <div class="service-info__name">${escHtml(item.name)}</div>
                ${detailLifetimeRowHtml(item, dataset)}
              </div>
            </div>
            <span class="status-chip status-chip--${calc.status}">
              <span data-lucide="${STATUS_ICONS[calc.status]}"></span>
              ${statusLabel(calc.status)}
            </span>
          </div>
          ${inactive ? `<div class="service-detail__actions">${detailActionRowHtml(item, inactive)}</div>` : ""}
        </section>
        ${detailOverviewSectionHtml(item, dataset)}
        ${detailHistorySectionHtml(services)}
      </div>
    </section>
  `;
}

/** Dropdown three-dot menu (ویرایش / حذف) pinned to the top corner of
 * every service card on the list page. */
function serviceItemMenuHtml(itemId: string): string {
  const open = state.serviceMenuId === itemId;
  return `
    <div class="card-menu service-card-menu">
      <button type="button" class="icon-btn js-service-menu-toggle" data-id="${escHtml(itemId)}"
        aria-haspopup="menu" aria-expanded="${open}"
        aria-label="${t("services.menuLabel")}" title="${t("services.menuLabel")}">
        <span data-lucide="more-vertical"></span>
      </button>
      ${open ? `
        <div class="card-menu__backdrop js-service-menu-backdrop"></div>
        <div class="card-menu__popover" role="menu" aria-label="${t("services.menuLabel")}">
          <button type="button" class="card-menu__item js-service-menu-edit" role="menuitem" data-id="${escHtml(itemId)}">
            <span data-lucide="pencil"></span>
            ${t("maintenance.editItem")}
          </button>
          <div class="card-menu__divider" role="separator"></div>
          <button type="button" class="card-menu__item card-menu__item--danger js-service-menu-delete" role="menuitem" data-id="${escHtml(itemId)}">
            <span data-lucide="trash-2"></span>
            ${t("maintenance.detail.delete")}
          </button>
        </div>` : ""}
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



/** Lifetime row under the service name:
 * `عمر قطعه ≈ ۴۰٬۰۰۰ کیلومتر (تقریباً ۲ سال)` when annual mileage allows
 * an estimate; otherwise just the km line. */
function detailLifetimeRowHtml(
  item: MaintenanceItem,
  dataset: ReturnType<typeof store.get>,
): string {
  const { intervalKm } = item.rule;
  if (intervalKm == null) return "";

  const averageAnnual =
    dataset.vehicles.find((vehicle) => vehicle.id === item.vehicleId)?.averageAnnualDistance ?? null;
  const estimatedDays =
    averageAnnual != null && Number.isFinite(averageAnnual) && averageAnnual > 0
      ? Math.round((intervalKm * 365) / averageAnnual)
      : null;
  const duration =
    estimatedDays != null && estimatedDays > 0
      ? ` (${t("services.approximately")} ${formatLifespanDuration(estimatedDays)})`
      : "";

  return `
    <div class="service-info__lifetime">
      ${t("services.lifeKm")} ≈ ${faNum(intervalKm)} ${t("common.kmUnit")}${duration}
    </div>
  `;
}

/**
 * Status section inside the unified detail card: three equal cards — part
 * health (heart + percentage), recommended replacement date (calendar +
 * remaining days), recommended replacement mileage (gauge + remaining km).
 * Cards run side by side on desktop and stack on narrow screens.
 */
function detailOverviewSectionHtml(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): string {
  const calc = calculateMaintenance(item, contextForVehicle(dataset, item.vehicleId));
  const percent = calc.remainingPercent;
  const rounded = percent != null ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  // The same rounded value colors the percentage text and the bar fill, so
  // the value and the chart always agree.
  const band = rounded != null ? healthBand(rounded, dataset.settings.statusThresholds) : null;

  const healthValue =
    rounded != null ? `${faNum(rounded)}<small class="status-card__unit">٪</small>` : "—";
  const healthBar =
    rounded != null && band != null
      ? `<div class="health-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rounded}" aria-label="${t("maintenance.detail.health")}">
          <div class="health-bar__fill health-bar__fill--${band}" style="width: ${rounded}%"></div>
        </div>`
      : "";

  const recommendedDate = calc.estimatedDueDate ?? calc.nextDueDate;
  const dateValue = recommendedDate ? formatDate(recommendedDate) : t("maintenance.detail.notRecorded");
  let dateSecondary = "";
  if (recommendedDate) {
    dateSecondary = formatRemainingCountdown(diffDays(recommendedDate, todayIso()));
  }

  const dueKm = calc.nextDueOdometer;
  const kmValue =
    dueKm != null ? `${faNum(dueKm)} ${t("common.kmUnit")}` : t("maintenance.detail.notRecorded");
  let kmSecondary = "";
  if (calc.remainingKm != null) {
    kmSecondary =
      calc.remainingKm >= 0
        ? `${faNum(calc.remainingKm)} ${t("common.kmUnit")} ${t("maintenance.detail.remainingKm")}`
        : `${faNum(-calc.remainingKm)} ${t("common.kmUnit")} ${t("maintenance.detail.pastKm")}`;
  }

  return `
    <section class="service-detail-card__status">
      <div class="status-grid">
        <article class="status-card">
          <span class="status-card__icon" data-lucide="heart" aria-hidden="true"></span>
          <h3 class="status-card__title">${t("maintenance.detail.health")}</h3>
          <div class="status-card__value${rounded != null && band != null ? ` status-card__value--${band}` : ""}">${healthValue}</div>
          ${healthBar}
        </article>
        <article class="status-card">
          <span class="status-card__icon" data-lucide="calendar" aria-hidden="true"></span>
          <h3 class="status-card__title">${t("maintenance.detail.recommendedDate")}</h3>
          <div class="status-card__value">${escHtml(dateValue)}</div>
          ${dateSecondary ? `<div class="status-card__secondary">${escHtml(dateSecondary)}</div>` : ""}
        </article>
        <article class="status-card">
          <span class="status-card__icon" data-lucide="gauge" aria-hidden="true"></span>
          <h3 class="status-card__title">${t("maintenance.detail.recommendedKm")}</h3>
          <div class="status-card__value">${escHtml(kmValue)}</div>
          ${kmSecondary ? `<div class="status-card__secondary">${escHtml(kmSecondary)}</div>` : ""}
        </article>
      </div>
    </section>
  `;
}

/** Row actions for a history record: a single three-dot button opening a
 * dropdown popover with the ویرایش / جزئیات / حذف text actions (nothing is
 * injected into the row itself). */
function historyRowActionsHtml(
  record: { id: string; date: string; odometer: number | null },
): string {
  const menuOpen = state.recordMenu?.recordId === record.id;
  return `
    <div class="history__actions">
      <button type="button" class="icon-btn js-record-menu-toggle" data-id="${escHtml(record.id)}"
        aria-haspopup="menu" aria-expanded="${menuOpen}"
        aria-label="${t("maintenance.detail.recordMenu")}" title="${t("maintenance.detail.recordMenu")}">
        <span data-lucide="more-horizontal"></span>
      </button>
      ${menuOpen ? recordMenuHtml(record.id) : ""}
    </div>
  `;
}

/** Dropdown popover + full-screen click-away backdrop for a record's menu. */
function recordMenuHtml(recordId: string): string {
  return `
    <div class="card-menu__backdrop js-record-menu-backdrop"></div>
    <div class="history-menu" role="menu" aria-label="${t("maintenance.detail.recordMenu")}">
      <button type="button" class="card-menu__item js-record-menu-edit" role="menuitem"
        data-id="${escHtml(recordId)}">
        <span data-lucide="pencil"></span>
        ${t("maintenance.detail.editRecord")}
      </button>
      <button type="button" class="card-menu__item js-record-menu-info" role="menuitem"
        data-id="${escHtml(recordId)}">
        <span data-lucide="info"></span>
        ${t("maintenance.detail.recordInfo")}
      </button>
      <div class="card-menu__divider" role="separator"></div>
      <button type="button" class="card-menu__item card-menu__item--danger js-record-menu-delete" role="menuitem"
        data-id="${escHtml(recordId)}">
        <span data-lucide="trash-2"></span>
        ${t("maintenance.detail.delete")}
      </button>
    </div>
  `;
}

/** Single-row history entry: date first, mileage after, actions at the left. */
function historyRecordRowHtml(
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
      ${historyRowActionsHtml(record)}
    </li>
  `;
}

/** History content inside the unified card's third section — collapsible:
 * the section header toggles the panel (collapsed by default, per item).
 * Every item's service history renders here (سوابق سرویس). */
function detailHistorySectionHtml(services: ServiceRecord[]): string {
  const serviceRows = sortHistoryNewestFirst(services)
    .map((record) => historyRecordRowHtml(record))
    .join("");

  const title = t("maintenance.detail.serviceHistoryTitle");
  const serviceBlock = serviceRows ? `<ul class="history__list">${serviceRows}</ul>` : "";

  let content = "";
  if (state.historyOpen) {
    content = `
    ${serviceBlock || `<p class="history__empty">${t("maintenance.detail.noServiceHistory")}</p>`}`;
  }

  return `
    <section class="service-detail-card__history service-detail__section--board">
      <h2 class="service-detail__section-title">
        <button type="button" class="collapse-head js-history-toggle" aria-expanded="${state.historyOpen}"
          aria-controls="service-detail-history-panel">
          <span>${title}</span>
          <span class="collapse-head__chevron" data-lucide="chevron-right"></span>
        </button>
      </h2>
      <div id="service-detail-history-panel" class="service-detail__history-panel">${content}</div>
    </section>
  `;
}

/* --- Record service forms (detail page) --- */

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

/** Record add/edit forms live in a modal overlay (never inline on the page). */
function recordFormModalHtml(): string {
  if (!state.recordForm) return "";
  return recordServiceFormModalHtml();
}

function recordServiceFormModalHtml(): string {
  const form = state.recordForm;
  const record = form ? findServiceRecord(form.recordId) : null;
  const isEdit = record != null;
  const itemId = form?.itemId ?? "";
  const defaultKm = defaultRecordOdometer(itemId);
  const title = isEdit ? t("maintenance.record.serviceEditTitle") : t("maintenance.record.serviceTitle");
  const currency = currencyLabel(store.get().settings.currency);

  return `
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
      <form id="record-form" class="form" novalidate>
        <div class="form__title">${escHtml(title)}</div>
        <div class="field">
          <label class="field__label" for="record-date">${t("maintenance.record.dateLabel")}</label>
          ${dateFieldHtml({
            fieldId: "record-date",
            name: "date",
            // Never auto-fill today — the user records the actual service
            // date (the record's own value still shows when editing).
            value: record?.date ?? "",
            label: t("maintenance.record.dateLabel"),
          })}
          <p class="field__error" id="record-error-date" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="record-odometer">${t("maintenance.record.odometerLabel")}</label>
          <div class="affix-field">
            <input class="field__input affix-field__input" id="record-odometer" name="odometer" type="number"
              inputmode="numeric" min="0" step="1" value="${record?.odometer ?? ""}" />
            <button type="button" class="affix-field__btn js-use-current-km"
              ${defaultKm == null ? "disabled" : ""}
              title="${escHtml(t("services.useCurrentKm"))}"
              aria-label="${escHtml(t("services.useCurrentKm"))}">
              <span data-lucide="download" aria-hidden="true"></span>
            </button>
          </div>
          <p class="field__error" id="record-error-odometer" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="record-cost">${t("maintenance.record.costLabel")}</label>
          <input class="field__input" id="record-cost" name="cost" type="number"
            inputmode="decimal" min="0" step="any" value="${record?.cost ?? ""}"
            placeholder="${faNum(0)} ${currency}" />
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

/** Popover showing the full detail of one history record (cost, notes…). */
function recordDetailsModalHtml(): string {
  const details = state.recordDetails;
  if (!details) return "";
  const record = findServiceRecord(details.recordId);
  if (!record) return "";
  const title = t("maintenance.detail.recordInfoServiceTitle");

  const rows: { label: string; value: string }[] = [];
  rows.push({ label: t("maintenance.record.dateLabel"), value: formatDate(record.date) });
  if (record.odometer != null) {
    rows.push({
      label: t("maintenance.record.odometerLabel"),
      value: `${faNum(record.odometer)} ${t("common.kmUnit")}`,
    });
  }
  if (record.cost != null) {
    rows.push({
      label: t("maintenance.detail.costLabel"),
      value: `${faNum(record.cost)} ${currencyLabel(store.get().settings.currency)}`,
    });
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
        <div class="modal__head">
          <div class="form__title">${escHtml(title)}</div>
          <button type="button" class="icon-btn js-close-overlay"
            aria-label="${t("common.close")}" title="${t("common.close")}">
            <span data-lucide="x"></span>
          </button>
        </div>
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
              data-id="${escHtml(confirm.recordId)}">
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

  /* Type-picker search: filtering happens on the live DOM (no redraw), so
   * the input keeps focus and the caret never jumps while typing. */
  const typeSearch = container.querySelector<HTMLInputElement>(".js-type-search");
  if (typeSearch) {
    typeSearch.addEventListener("input", () => {
      state.typeQuery = typeSearch.value;
      applyTypeFilter(container);
    });
    // A first Escape clears the query; the global handler only closes the
    // modal when the field is already empty.
    typeSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && typeSearch.value !== "") {
        state.typeQuery = "";
        typeSearch.value = "";
        typeSearch.dispatchEvent(new Event("input"));
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }
  container.querySelectorAll<HTMLButtonElement>(".js-type-search-clear").forEach((button) => {
    button.addEventListener("click", () => {
      const input = container.querySelector<HTMLInputElement>(".js-type-search");
      if (!input) return;
      state.typeQuery = "";
      input.value = "";
      input.dispatchEvent(new Event("input"));
      input.focus();
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
    if (state.serviceMenuId) {
      state.serviceMenuId = null;
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
  state.typeQuery = "";
}

function openServiceForm(catalogId: string | null): void {
  state.pickerOpen = false;
  state.form = { mode: "add", catalogId: catalogId === "" ? null : catalogId };
  state.iconPickerOpen = false;
  state.formValues = {};
  const entry = catalogId ? catalogEntry(catalogId) : null;
  state.icon = entry?.icon ?? "wrench";
  state.displayMode = healthMode(entry?.displayMode ?? "km");
}

function openEditServiceForm(item: MaintenanceItem): void {
  state.pickerOpen = false;
  state.form = { mode: "edit", itemId: item.id };
  state.iconPickerOpen = false;
  state.formValues = {};
  state.icon = item.icon;
  state.displayMode = healthMode(item.rule.displayMode);
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
  state.serviceMenuId = null;
}

/** Events on the detail page. */
function bindDetailEvents(container: HTMLElement): void {
  const currentItemId = maintenanceItemIdFromHash(window.location.hash);

  /* Service History section on the detail page: expand/collapse. */
  container.querySelectorAll<HTMLButtonElement>(".js-history-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      state.historyOpen = !state.historyOpen;
      redraw(container);
    });
  });

  /* ویرایش/حذف on the detail page's top bar + the three-dot menu on list
   * service cards: both share these actions (edit form, delete confirm). */
  container.querySelectorAll<HTMLButtonElement>(".js-service-menu-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id ?? null;
      state.recordMenu = null;
      state.serviceMenuId = state.serviceMenuId === id ? null : id;
      redraw(container);
    });
  });
  container.querySelector<HTMLElement>(".js-service-menu-backdrop")?.addEventListener("click", () => {
    state.serviceMenuId = null;
    redraw(container);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-service-menu-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const item = store.get().maintenanceItems.find((candidate) => candidate.id === button.dataset.id);
      if (!item) return;
      state.serviceMenuId = null;
      openEditServiceForm(item);
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-service-menu-delete").forEach((button) => {
    button.addEventListener("click", () => {
      state.serviceMenuId = null;
      state.deleteConfirmId = button.dataset.id ?? null;
      redraw(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".js-record-service").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordDetails = null;
      state.recordMenu = null;
      state.recordDeleteConfirm = null;
      state.serviceMenuId = null;
      state.recordForm = { recordId: null, itemId: button.dataset.id ?? currentItemId ?? "" };
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
      const id = button.dataset.id ?? "";
      state.recordMenu = state.recordMenu?.recordId === id ? null : { recordId: id };
      state.serviceMenuId = null;
      redraw(container);
    });
  });
  container.querySelector<HTMLElement>(".js-record-menu-backdrop")?.addEventListener("click", () => {
    state.recordMenu = null;
    redraw(container);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-record-menu-edit").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordMenu = null;
      state.recordDetails = null;
      state.recordDeleteConfirm = null;
      state.recordForm = { recordId: button.dataset.id ?? null, itemId: currentItemId ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-record-menu-info").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordMenu = null;
      state.recordForm = null;
      state.recordDeleteConfirm = null;
      state.recordDetails = { recordId: button.dataset.id ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-record-menu-delete").forEach((button) => {
    button.addEventListener("click", () => {
      state.recordMenu = null;
      state.recordForm = null;
      state.recordDetails = null;
      state.recordDeleteConfirm = { recordId: button.dataset.id ?? "" };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-confirm-record-delete").forEach((button) => {
    button.addEventListener("click", () => {
      deleteRecord(button.dataset.id ?? "");
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

/** Removes one history record (service event). */
function deleteRecord(recordId: string): void {
  if (!recordId) return;
  state.recordDeleteConfirm = null;
  state.recordMenu = null;
  store.update((draft) => {
    draft.serviceHistory = draft.serviceHistory.filter((record) => record.id !== recordId);
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
  /* «استفاده از کیلومتر فعلی»: quick-fills the last-replacement odometer
   * with the vehicle's registered mileage. Only a UI convenience — the
   * value flows through the same input/capture path as manual typing. */
  container.querySelectorAll<HTMLButtonElement>(".js-use-current-km").forEach((button) => {
    button.addEventListener("click", () => {
      const dataset = store.get();
      const vehicleId = resolveSelectedVehicleId(dataset);
      const km = vehicleId ? (dataset.vehicles.find((v) => v.id === vehicleId)?.currentOdometer ?? null) : null;
      if (km == null) return;
      const input = container.querySelector<HTMLInputElement>("#service-odometer");
      if (!input) return;
      input.value = String(km);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  /* «استفاده از مقدار پیشنهادی»: fills عمر قطعه from the configured
   * recommendation. Only on click — never overwrites typed values alone. */
  container.querySelectorAll<HTMLButtonElement>(".js-use-recommended-km").forEach((button) => {
    button.addEventListener("click", () => {
      const km = Number(button.dataset.recommendedKm);
      if (!Number.isFinite(km) || km <= 0) return;
      const input = container.querySelector<HTMLInputElement>("#service-km");
      if (!input) return;
      input.value = String(km);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
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
  /* «استفاده از کیلومتر فعلی»: quick-fills the record's odometer with the
   * vehicle's registered mileage — same convenience as in the service form. */
  container.querySelectorAll<HTMLButtonElement>(".js-use-current-km").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = state.recordForm?.itemId ?? "";
      const km = defaultRecordOdometer(itemId);
      if (km == null) return;
      const input = container.querySelector<HTMLInputElement>("#record-odometer");
      if (!input) return;
      input.value = String(km);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
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
  const intervalKm = kmRaw === "" ? null : Number(toLatinDigits(kmRaw));
  // Time-based part lifetime was removed — parts are tracked by mileage only.
  const intervalMonths = null;
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
      };
      target.updatedAt = new Date().toISOString();
    });
    return;
  }

  // Add a new service for the chosen vehicle.
  const entry = serviceForm.catalogId ? catalogEntry(serviceForm.catalogId) : null;
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
    displayMode: state.displayMode,
  };
  const errors = validateItemDraft(draft);
  const initialErrors = validateInitialService({ date, odometer }, todayIso());
  const costRaw = String(data.get("serviceCost") ?? "").trim();
  const cost = costRaw === "" ? null : Number(toLatinDigits(costRaw));
  const recordErrors = validateServiceRecordEntry({ date, odometer, cost }, { today: todayIso() });

  if (errors.length > 0 || initialErrors.length > 0 || recordErrors.length > 0) {
    showServiceErrors(container, [
      ...errors.map((error): [ItemDraftError | InitialDataError | ServiceRecordError, string] => [error, t(DRAFT_ERROR_KEYS[error])]),
      ...initialErrors.map((error): [ItemDraftError | InitialDataError | ServiceRecordError, string] => [error, t(INITIAL_ERROR_KEYS[error])]),
      ...recordErrors.map((error): [ItemDraftError | InitialDataError | ServiceRecordError, string] => [error as ItemDraftError | InitialDataError | ServiceRecordError, t(SERVICE_ERROR_KEYS[error])]),
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
    draftData.serviceHistory.push({
      id: createId(),
      maintenanceItemId: itemId,
      vehicleId,
      date,
      odometer,
      notes: "",
      cost,
      createdAt: now,
    });
  });
}

function showServiceErrors(
  container: HTMLElement,
  errors: [ItemDraftError | InitialDataError | ServiceRecordError, string][],
): void {
  for (const [error, message] of errors) {
    const id =
      error in DRAFT_ERROR_IDS
        ? DRAFT_ERROR_IDS[error as ItemDraftError]
        : error === "invalidOdometer"
          ? "service-error-odometer"
          : error === "invalidCost"
            ? "service-error-cost"
            : "service-error-date";
    const element = container.querySelector<HTMLElement>(`#${id}`);
    if (element) {
      element.textContent = message;
      element.hidden = false;
    }
  }
}

/* --- Submit: record service events (detail page) --- */

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
}

function showRecordErrors(container: HTMLElement, errors: [ServiceRecordError, string][]): void {
  for (const [error, message] of errors) {
    const fieldId =
      error === "invalidOdometer"
        ? "record-error-odometer"
        : error === "invalidCost"
          ? "record-error-cost"
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
  bindFloatingFields(container);
  applyTypeFilter(container);
  alignFabBar();
}
