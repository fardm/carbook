import {
  evaluateReminder,
  remainingDays,
  remainingKm,
  validateReminderDraft,
  type ReminderDraftError,
  type ReminderStatus,
} from "../domain/reminders";
import {
  notificationsSupported,
  notificationPermission,
  runReminderCheck,
  advanceRecurringReminders,
} from "../domain/reminder-checker";
import { recommendedDueForService, resolveReminder } from "../domain/reminder-sync";
import { isValidIso, todayIso, weekdayOf } from "../domain/calendar";
import { formatDate } from "../domain/calendar/format";
import { createId } from "../domain/ids";
import type {
  MaintenanceItem,
  NotificationOffset,
  Reminder,
  RepeatMode,
  Vehicle,
} from "../domain/types";
import { t } from "../i18n";
import { store } from "../state/store";
import { maintenanceDetailHash } from "../ui/router";
import { faNum, toLatinDigits } from "../ui/format";
import { bindDateFields, dateFieldHtml } from "../ui/date-field";
import { escHtml } from "../ui/escape";
import { alignFabBar } from "../ui/fab";
import { bindFloatingFields } from "../ui/floating-field";
import { applyIcons } from "../ui/icons";
import {
  remindersEditIdFromHash,
  remindersFocusIdFromHash,
  remindersServiceIdFromHash,
  remindersVehicleIdFromHash,
} from "../ui/router";

/**
 * Reminders view — the vehicle-scoped reminder list (یادآوری‌ها).
 *
 * Mirrors the Services page: same vehicle selector (vehicle-menu), same
 * segmented filters, same card/status-chip design language, same modal
 * form patterns (floating fields + date field + affix field + toggle).
 *
 * Vehicle context: the page-level selector is THE context — every list,
 * the add form, and the service→reminder prefill flow use it. There is no
 * vehicle field inside the reminder form and no "all vehicles" option.
 */

interface ReminderViewState {
  selectedVehicleId: string | null;
  /** "all" | "upcoming" | "due" | "disabled" */
  filter: "all" | "upcoming" | "due" | "disabled";
  /** Add/edit form modal; null = closed. */
  form: { mode: "add"; prefill: ReminderPrefill | null } | { mode: "edit"; reminderId: string } | null;
  /** Typed form values keyed by input name — survive re-renders (decision 31). */
  formValues: Record<string, string>;
  /** Which reminder type the form currently shows. */
  formType: Reminder["type"];
  /** Which repeat mode the form currently shows; "none" = the تکرار
   * toggle is OFF (its config fields render disabled). */
  formRepeat: RepeatMode;
  /** Day-of-week for repeat "weekly" while the form is open
   * (0 = Saturday … 6 = Friday, the domain/calendar weekdayOf convention). */
  formWeekday: number | null;
  /** Whether the form's اعلان پیش از موعد section is on (Req 4). */
  formNotifications: boolean;
  /** LIVE state of the همگام با تعویض پیشنهادی toggle (service-based
   * forms only): true = due values resolve from the service; false = the
   * displayed values become editable and the reminder is saved manual. */
  formSynced: boolean;
  /** Filter dropdown popover is open. */
  filterMenuOpen: boolean;
  /** Reminder whose card the index should scroll to + temporarily
   * highlight (set by `#/reminders?focus=<id>`; cleared after the pulse). */
  focusReminderId: string | null;
  /** Reminder pending deletion (confirm modal). */
  deleteConfirmId: string | null;
  /** First-notification permission prompt (Phase 7). */
  permissionPrompt: { pendingReminder: PendingReminder } | null;
  /** Info note after saving without browser permission ("فعلاً نه"). */
  permissionNotice: string | null;
  /** Vehicle picker popover is open. */
  vehicleMenuOpen: boolean;
  /** Add Reminder action menu is open. */
  addMenuOpen: boolean;
  /** Which form mode: "general" or "service" */
  formMode: "general" | "service";
}

/** Values carried into the add form.
 * Manual flow (Reminders page): serviceId null + synced false — the user
 * controls every value. Service flow (service page): synced true — title
 * and due values come from the service and render read-only. */
interface ReminderPrefill {
  vehicleId: string;
  serviceId: string | null;
  title: string;
  dueDate: string | null;
  dueMileage: number | null;
  /** Vehicle's current odometer at prefill time, for the hint row. */
  currentOdometer: number | null;
  /** True = service-synchronized form (service page entry point). */
  synced: boolean;
}

/** A reminder ready to save, waiting on the permission decision (Phase 7). */
interface PendingReminder {
  reminder: Reminder;
  /** True when the user asked for browser notifications (enabled form). */
  wantsNotifications: boolean;
}

const state: ReminderViewState = {
  selectedVehicleId: null,
  filter: "all",
  form: null,
  formValues: {},
  formType: "date",
  formRepeat: "none",
  formWeekday: null,
  formNotifications: false,
  formSynced: false,
  focusReminderId: null,
  deleteConfirmId: null,
  filterMenuOpen: false,
  permissionPrompt: null,
  permissionNotice: null,
  vehicleMenuOpen: false,
  addMenuOpen: false,
  formMode: "general",
};

/** Typed form-field value that survives re-renders. */
function fieldValue(field: string, fallback: string = ""): string {
  return state.formValues[field] ?? fallback;
}

/** Keeps typed form fields in state so redraws never wipe them. */
function captureFormValue(event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  if (!target || !target.name || target.type === "checkbox") return;
  state.formValues[target.name] = target.value;
}

const ERROR_KEYS: Record<ReminderDraftError, Parameters<typeof t>[0]> = {
  titleRequired: "reminders.errorTitleRequired",
  dueDateRequired: "reminders.errorDueDateRequired",
  dueDateInvalid: "reminders.errorDueDateInvalid",
  dueMileageRequired: "reminders.errorDueMileageRequired",
  dueMileageInvalid: "reminders.errorDueMileageInvalid",
  conditionRequired: "reminders.errorConditionRequired",
  syncDateUnavailable: "reminders.errorSyncDateUnavailable",
  syncKmUnavailable: "reminders.errorSyncKmUnavailable",
  repeatWeekdayInvalid: "reminders.errorRepeatWeekday",
  repeatKmRequired: "reminders.errorRepeatKmRequired",
  repeatKmInvalid: "reminders.errorRepeatKmInvalid",
  offsetInvalid: "reminders.errorOffsetInvalid",
};

/** Persian weekday names, Saturday-first (matches weekdayOf/weekday select). */
const WEEKDAY_KEYS = [
  "reminders.weekday0",
  "reminders.weekday1",
  "reminders.weekday2",
  "reminders.weekday3",
  "reminders.weekday4",
  "reminders.weekday5",
  "reminders.weekday6",
] as const;

/** Localized weekday name for a Saturday-first weekday number (0 = Saturday … 6 = Friday). */
function weekdayLabel(weekday: number): string {
  return t(WEEKDAY_KEYS[weekday] ?? WEEKDAY_KEYS[0]);
}

/** Default weekday for the weekly repeat: the due date's own weekday when
 * valid, otherwise Saturday (0) — the start of the Persian week. */
function defaultWeekdayFor(dueDate: string | null): number {
  if (dueDate != null && isValidIso(dueDate)) return weekdayOf(dueDate);
  return 0;
}

export function renderReminders(container: HTMLElement): () => void {
  // Deep links (service page → synchronized reminder, "بررسی یادآوری" →
  // edit form, status label → focus) are consumed ONCE per navigation —
  // store-driven redraws below never re-open forms.
  consumeReminderHash();
  const draw = (): void => {
    activeContainer = container;
    paintView(container);
  };
  registerGlobalKeys();
  draw();
  return store.subscribe(draw);
}

/* --- View-level key handling (Escape closes modal/menus) --- */

let globalKeysBound = false;
let activeContainer: HTMLElement | null = null;

function registerGlobalKeys(): void {
  if (globalKeysBound) return;
  globalKeysBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // A date popover owns Escape first (same contract as the services view).
    const datePopoverOpen =
      document.querySelector<HTMLElement>("[data-df-popover]:not([hidden])") != null;
    if (datePopoverOpen) return;
    const container = activeContainer;
    if (!container) return;
    if (state.permissionPrompt) {
      state.permissionPrompt = null;
      redraw(container);
      return;
    }
    if (state.deleteConfirmId) {
      state.deleteConfirmId = null;
      redraw(container);
      return;
    }
    if (state.form) {
      closeForm();
      redraw(container);
      return;
    }
    if (state.vehicleMenuOpen) {
      state.vehicleMenuOpen = false;
      redraw(container);
      return;
    }
    if (state.filterMenuOpen) {
      state.filterMenuOpen = false;
      redraw(container);
      return;
    }
  });
}

/* --- Vehicle resolution --- */

/** Selected vehicle: view selection → URL param → default → first vehicle. */
function resolveSelectedVehicleId(dataset: ReturnType<typeof store.get>): string | null {
  if (state.selectedVehicleId && dataset.vehicles.some((v) => v.id === state.selectedVehicleId)) {
    return state.selectedVehicleId;
  }
  const param = remindersVehicleIdFromHash(window.location.hash);
  if (param && dataset.vehicles.some((v) => v.id === param)) return param;
  const defaultId = dataset.settings.defaultVehicleId;
  if (defaultId && dataset.vehicles.some((v) => v.id === defaultId)) return defaultId;
  return dataset.vehicles[0]?.id ?? null;
}

/* --- Top-level page --- */

function remindersViewHtml(): string {
  const dataset = store.get();
  const vehicleId = resolveSelectedVehicleId(dataset);
  const toolbar = remindersToolbarHtml(dataset, vehicleId);
  const body =
    dataset.vehicles.length === 0
      ? remindersNoVehicleHtml()
      : vehicleId == null
        ? remindersNoVehicleHtml()
        : remindersListHtml(dataset, vehicleId);
  const overlay = reminderOverlayHtml(dataset, vehicleId);
  const noVehicles = dataset.vehicles.length === 0;

  return `
    <div class="view-stack view-stack--fab">
      <div class="page-header">
        <h1 class="view-title">${t("view.reminders.title")}</h1>
      </div>
      <div class="services-toolbar-row">${toolbar}</div>
      ${body}
      ${overlay}
      ${fabBarHtml(noVehicles)}
    </div>
  `;
}

/**
 * Floating add button — uses the FAB/Action Menu pattern from Service Details.
 * The button opens a floating action menu with General Reminder and Service Reminder options.
 */
function fabBarHtml(disabled: boolean): string {
  const open = state.addMenuOpen;
  return `
    <div class="fab-bar fab-bar--page">
      <div class="fab-menu fab-menu--up${open ? " fab-menu--open" : ""}">
        ${addReminderMenuHtml(open, disabled)}
      </div>
    </div>
  `;
}

/**
 * Add Reminder action menu — offers General Reminder and Service Reminder options.
 * Reuses the same FAB/Action Menu pattern as Service Details.
 */
function addReminderMenuHtml(open: boolean, disabled: boolean): string {
  return `
    <div class="card-menu__backdrop js-add-menu-close"></div>
    <div class="fab-menu__actions" role="menu" aria-label="${t("reminders.addReminder")}">
      <button type="button" class="card-menu__item fab-menu__action js-add-service-reminder"
        role="menuitem" style="--fab-stagger: 1">
        <span data-lucide="wrench" aria-hidden="true"></span>
        ${t("reminders.serviceReminder")}
      </button>
      <button type="button" class="card-menu__item fab-menu__action js-add-general-reminder"
        role="menuitem" style="--fab-stagger: 0">
        <span data-lucide="bell" aria-hidden="true"></span>
        ${t("reminders.generalReminder")}
      </button>
    </div>
    <button type="button" class="btn btn--filled fab-menu__toggle js-add-menu-toggle"
      aria-haspopup="menu" aria-expanded="${open}"
      aria-label="${t("reminders.addReminder")}" ${disabled ? "disabled" : ""}>
      <span class="fab-menu__toggle-icon fab-menu__toggle-icon--plus" aria-hidden="true">
        <span data-lucide="plus"></span>
      </span>
      <span>${t("reminders.addReminder")}</span>
    </button>
  `;
}

/**
 * Opens/closes the Add Reminder FAB menu by toggling the mounted panel's
 * class (CSS transitions animate both directions); aria-expanded and state
 * stay in sync so later full redraws render the same state.
 */
function setAddMenuOpen(container: HTMLElement, open: boolean): void {
  state.addMenuOpen = open;
  container.querySelectorAll<HTMLElement>(".fab-menu").forEach((menu) => {
    menu.classList.toggle("fab-menu--open", open);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-add-menu-toggle").forEach((button) => {
    button.setAttribute("aria-expanded", String(open));
  });
}

/** Toolbar: the SAME vehicle selector as Services + the add action. */
function remindersToolbarHtml(dataset: ReturnType<typeof store.get>, selectedId: string | null): string {
  const noVehicles = dataset.vehicles.length === 0;
  const open = state.addMenuOpen;
  const addButton = `
    <div class="fab-menu fab-menu--topbar${open ? " fab-menu--open" : ""}">
      ${addReminderMenuHtml(open, noVehicles)}
    </div>`;
  return `<div class="services-toolbar"><div class="services-toolbar__controls">${vehicleMenuHtml(dataset, selectedId)}${filterMenuHtml(noVehicles)}</div>${addButton}</div>`;
}

/** Vehicle picker — same component/style as the Services page toolbar. */
function vehicleMenuHtml(dataset: ReturnType<typeof store.get>, selectedId: string | null): string {
  const selectedVehicle = dataset.vehicles.find((v) => v.id === selectedId) ?? null;
  const triggerLabel = selectedVehicle ? escHtml(selectedVehicle.name) : escHtml(t("reminders.vehicleLabel"));
  const disabled = dataset.vehicles.length === 0;

  const items = dataset.vehicles
    .map(
      (vehicle) => `
        <button type="button" class="card-menu__item js-vehicle-option"
          data-vehicle-id="${escHtml(vehicle.id)}"
          aria-pressed="${vehicle.id === selectedId}">
          ${escHtml(vehicle.name)}
          ${vehicle.id === selectedId ? `<span class="card-menu__check" aria-hidden="true" data-lucide="circle-check"></span>` : ""}
        </button>`,
    )
    .join("");

  return `
    <div class="vehicle-menu${state.vehicleMenuOpen ? " vehicle-menu--open" : ""}">
      ${state.vehicleMenuOpen ? `<div class="card-menu__backdrop js-vehicle-menu-close"></div>` : ""}
      <button type="button" class="btn btn--secondary vehicle-menu__trigger js-vehicle-menu-toggle"
        aria-haspopup="true" aria-expanded="${state.vehicleMenuOpen}"
        aria-label="${escHtml(t("reminders.vehicleLabel"))}"
        ${disabled ? "disabled" : ""}>
        <span data-lucide="car" aria-hidden="true"></span>
        ${triggerLabel}
        <span class="vehicle-menu__chevron" data-lucide="chevron-right" aria-hidden="true"></span>
      </button>
      ${state.vehicleMenuOpen ? `<div class="card-menu__popover vehicle-menu__popover" role="menu">${items}</div>` : ""}
    </div>
  `;
}

/** Filter menu (All / Upcoming / Due & overdue / Disabled) — same dropdown pattern. */
function filterMenuHtml(disabled: boolean): string {
  const options: Array<{ value: ReminderViewState["filter"]; key: Parameters<typeof t>[0] }> = [
    { value: "all", key: "reminders.filterAll" },
    { value: "upcoming", key: "reminders.filterUpcoming" },
    { value: "due", key: "reminders.filterDue" },
    { value: "disabled", key: "reminders.filterDisabled" },
  ];
  const items = options
    .map(
      (option) => `
        <button type="button" class="card-menu__item js-filter-option" data-filter="${option.value}"
          aria-pressed="${state.filter === option.value}">
          ${t(option.key)}
          ${state.filter === option.value ? `<span class="card-menu__check" aria-hidden="true" data-lucide="circle-check"></span>` : ""}
        </button>`,
    )
    .join("");
  return `
    <div class="sort-menu${state.filterMenuOpen ? " sort-menu--open" : ""}">
      ${state.filterMenuOpen ? `<div class="card-menu__backdrop js-filter-menu-close"></div>` : ""}
      <!-- filter -->
      <button type="button" class="btn btn--secondary sort-menu__trigger js-filter-menu-toggle"
        aria-haspopup="true" aria-expanded="${state.filterMenuOpen}"
        aria-label="${t("reminders.filterLabel")}"
        ${disabled ? "disabled" : ""}>
        <span data-lucide="filter" aria-hidden="true"></span>
        ${t(options.find((option) => option.value === state.filter)!.key)}
      </button>
      ${state.filterMenuOpen ? `<div class="card-menu__popover sort-menu__popover" role="menu">${items}</div>` : ""}
    </div>
  `;
}

function remindersNoVehicleHtml(): string {
  return `
    <section class="card services-empty">
      <span class="services-empty__icon" data-lucide="bell"></span>
      <p class="services-empty__text">${t("reminders.noVehicles")}</p>
      <a class="btn btn--filled" href="#/vehicle">${t("reminders.goToVehicles")}</a>
    </section>
  `;
}

/* --- Reminder list --- */

function remindersListHtml(dataset: ReturnType<typeof store.get>, vehicleId: string): string {
  const vehicle = dataset.vehicles.find((v) => v.id === vehicleId) ?? null;
  const reminders = dataset.reminders.filter((reminder) => reminder.vehicleId === vehicleId);
  // Service-synchronized reminders resolve their due values live from the
  // service's next-recommended schedule — the service is the source of
  // truth for evaluation, sorting, and the displayed schedule.
  const evaluated = reminders.map((reminder) => {
    const effective = resolveReminder(reminder, dataset);
    return {
      reminder: effective,
      evaluation: evaluateReminder(effective, vehicle?.currentOdometer ?? null),
    };
  });

  const filtered = evaluated.filter(({ reminder, evaluation }) => {
    switch (state.filter) {
      case "upcoming":
        return reminder.enabled && evaluation.status === "upcoming";
      case "due":
        return reminder.enabled && (evaluation.status === "dueSoon" || evaluation.status === "dueToday" || evaluation.status === "due" || evaluation.status === "overdue");
      case "disabled":
        return !reminder.enabled;
      default:
        return true;
    }
  });

  if (reminders.length === 0) {
    return `
      <section class="card services-empty">
        <span class="services-empty__icon" data-lucide="bell"></span>
        <p class="services-empty__text">${t("reminders.noReminders")}</p>
      </section>
    `;
  }
  if (filtered.length === 0) {
    return `
      <section class="card services-empty">
        <span class="services-empty__icon" data-lucide="filter"></span>
        <p class="services-empty__text">${t("reminders.filterEmpty")}</p>
      </section>
    `;
  }

  // Most urgent first; disabled reminders sink to the bottom.
  filtered.sort((a, b) => {
    if (a.reminder.enabled !== b.reminder.enabled) return a.reminder.enabled ? -1 : 1;
    const order: ReminderStatus[] = ["overdue", "due", "dueToday", "dueSoon", "upcoming", "disabled"];
    const diff = order.indexOf(a.evaluation.status) - order.indexOf(b.evaluation.status);
    if (diff !== 0) return diff;
    return a.reminder.createdAt.localeCompare(b.reminder.createdAt);
  });

  return `<div class="services-grid reminders-grid">
    ${filtered.map(({ reminder }) => reminderCardHtml(reminder, vehicle, dataset)).join("")}
  </div>`;
}

/** Due date/mileage + remaining lines for one reminder card. */
function reminderScheduleLines(
  reminder: Reminder,
  vehicle: Vehicle | null,
): Array<{ text: string; icon: "calendar" | "gauge" }> {
  const lines: Array<{ text: string; icon: "calendar" | "gauge" }> = [];
  const days = remainingDays(reminder);
  const km = remainingKm(reminder, vehicle?.currentOdometer ?? null);

  if (reminder.dueDate != null) {
    const suffix =
      days == null ? "" : days >= 0 ? t("reminders.remainingDays") : t("reminders.pastDays");
    const remaining = days == null ? "" : ` — ${faNum(Math.abs(days))} ${suffix}`;
    lines.push({ text: `${formatDate(reminder.dueDate)}${remaining}`, icon: "calendar" });
  }
  if (reminder.dueMileage != null) {
    const suffix =
      km == null ? "" : km >= 0 ? t("reminders.remainingKm") : t("reminders.pastKm");
    const remaining = km == null ? "" : ` — ${faNum(Math.abs(km))} ${suffix}`;
    lines.push({
      text: `${faNum(reminder.dueMileage)} ${t("common.kmUnit")}${remaining}`,
      icon: "gauge",
    });
  }
  return lines;
}

function reminderCardHtml(reminder: Reminder, vehicle: Vehicle | null, dataset: ReturnType<typeof store.get>): string {
  const service = reminder.serviceId
    ? (dataset.maintenanceItems.find((item) => item.id === reminder.serviceId) ?? null)
    : null;
  const schedule = reminderScheduleLines(reminder, vehicle);

  const repeatLabel =
    reminder.repeat === "monthly"
      ? t("reminders.repeatMonthly")
      : reminder.repeat === "yearly"
        ? t("reminders.repeatYearly")
        : reminder.repeat === "km"
          ? `${t("reminders.repeatKm")}: ${faNum(reminder.repeatEveryKm ?? 0)} ${t("common.kmUnit")}`
          : reminder.repeat === "weekly"
            ? reminder.repeatWeekday != null
              ? `${t("reminders.repeatWeekly")} (${weekdayLabel(reminder.repeatWeekday)})`
              : t("reminders.repeatWeekly")
            : null;

  return `
    <article class="card service-card reminder-card js-reminder-card${reminder.enabled ? "" : " reminder-card--disabled"}" data-id="${escHtml(reminder.id)}"
      tabindex="0" role="button" aria-label="${escHtml(t("reminders.editTitle"))}">
      <div class="reminder-card__content">
        <div class="service-card__head">
          <div class="service-card__info">
            <div class="service-card__name">${escHtml(reminder.title)}</div>
            ${
              service
                ? `<a class="reminder-card__service" href="${maintenanceDetailHash(service.id)}"><span data-lucide="link"></span>${escHtml(service.name)}</a>`
                : ""
            }
          </div>
        </div>
        <div class="service-card__body reminder-card__body">
          <div class="service-card__detail reminder-card__detail">
            ${schedule.map((line) => `<div class="metric service-card__last"><span data-lucide="${line.icon}"></span>${escHtml(line.text)}</div>`).join("")}
            ${repeatLabel ? `<div class="metric service-card__last metric--muted reminder-card__repeat"><span data-lucide="repeat"></span>${escHtml(repeatLabel)}</div>` : ""}
          </div>
        </div>
      </div>
      <label class="toggle reminder-card__toggle" title="${t("reminders.enabledLabel")}">
        <input type="checkbox" class="js-reminder-toggle" data-id="${escHtml(reminder.id)}"
          role="switch" aria-label="${t("reminders.enabledLabel")}" ${reminder.enabled ? "checked" : ""} />
        <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
      </label>
    </article>
  `;
}

/* --- Add/edit form modal (Phase 5) --- */

function reminderOverlayHtml(dataset: ReturnType<typeof store.get>, vehicleId: string | null): string {
  if (state.deleteConfirmId) return deleteConfirmModalHtml();
  if (state.permissionPrompt) return permissionPromptModalHtml();
  if (state.form) return reminderFormModalHtml(dataset, vehicleId);
  return state.permissionNotice != null ? permissionNoticeHtml() : "";
}

/** The soft info note shown after saving without browser permission. */
function permissionNoticeHtml(): string {
  return `
    <div class="box box--warn reminder-permission-notice" role="status">
      <span data-lucide="bell-off"></span>
      <span>${escHtml(state.permissionNotice ?? "")}</span>
      <button type="button" class="btn btn--text js-dismiss-notice">${t("settings.dismiss")}</button>
    </div>
  `;
}

function reminderFormModalHtml(dataset: ReturnType<typeof store.get>, vehicleId: string | null): string {
  const editing = state.form?.mode === "edit";
  const prefill = !editing && state.form?.mode === "add" ? state.form.prefill : null;
  const vehicle = vehicleId != null ? (dataset.vehicles.find((v) => v.id === vehicleId) ?? null) : null;
  const isGeneralMode = state.formMode === "general";
  const title = editing ? t("reminders.editTitle") : (isGeneralMode ? t("reminders.addGeneralTitle") : t("reminders.addServiceTitle"));

  // Service-based forms (service page entry point, or editing any reminder
  // that has a serviceId): the همگام با تعویض پیشنهادی toggle decides
  // whether the SERVICE is the source of truth (values resolve live and
  // render read-only) or the user owns the values (editable, saved as a
  // manual reminder that keeps its serviceId reference).
  const editingReminder = editing
    ? (dataset.reminders.find((r) => r.id === (state.form as { reminderId: string }).reminderId) ?? null)
    : null;
  const serviceLinked = editing
    ? (editingReminder?.serviceId ?? null)
    : (prefill?.serviceId ?? fieldValue("serviceId") ?? null);
  const synced = serviceLinked != null && state.formSynced;
  const syncSource = (() => {
    if (serviceLinked == null) return null;
    const item = dataset.maintenanceItems.find((candidate) => candidate.id === serviceLinked);
    return item ? recommendedDueForService(item, dataset) : null;
  })();
  // While synced, the title mirrors the service's current name (same rule
  // the submit path applies); the editable/manual value comes from state.
  const syncedServiceName =
    synced && serviceLinked != null
      ? (dataset.maintenanceItems.find((candidate) => candidate.id === serviceLinked)?.name ?? null)
      : null;

  const typeOptions: Array<{ value: Reminder["type"]; key: Parameters<typeof t>[0] }> = [
    { value: "date", key: "reminders.typeDate" },
    { value: "mileage", key: "reminders.typeMileage" },
    { value: "date_mileage", key: "reminders.typeDateMileage" },
  ];
  const typeHintKey: Record<Reminder["type"], Parameters<typeof t>[0]> = {
    date: "reminders.typeDateHint",
    mileage: "reminders.typeMileageHint",
    date_mileage: "reminders.typeDateMileageHint",
  };

  // Recurrence choices (Req 3): only for general reminders
  const repeatOptions: Array<{ value: RepeatMode; key: Parameters<typeof t>[0] }> = [
    { value: "daily", key: "reminders.repeatDaily" },
    { value: "weekly", key: "reminders.repeatWeekly" },
    { value: "monthly", key: "reminders.repeatMonthly" },
    { value: "yearly", key: "reminders.repeatYearly" },
  ];

  const watchesDate = state.formType === "date" || state.formType === "date_mileage";
  const watchesKm = state.formType === "mileage" || state.formType === "date_mileage";

  // Synced due fields are READ-ONLY displays of the service's current
  // recommendation (no name attribute — the submit path re-resolves them
  // from the service, so a stale form value can never be persisted). When
  // the service cannot provide a value, a clear hint replaces it.
  const syncDate = synced ? (syncSource?.dueDate ?? null) : null;
  const syncKm = synced ? (syncSource?.dueMileage ?? null) : null;

  // Service selection dropdown for service reminder mode - always visible for service reminders
  const serviceSelectField = !isGeneralMode
    ? `
    <div class="field">
      <label class="field__label" for="reminder-service">${t("reminders.serviceLabel")}</label>
      <select class="field__input js-reminder-service" id="reminder-service" name="serviceId" ${editing && serviceLinked != null ? "disabled" : ""}>
        <option value="">${t("reminders.selectService")}</option>
        ${dataset.maintenanceItems
          .filter((item) => item.active && item.vehicleId === vehicleId)
          .map(
            (item) => `
        <option value="${escHtml(item.id)}" ${fieldValue("serviceId") === item.id || serviceLinked === item.id ? "selected" : ""}>${escHtml(item.name)}</option>`,
          )
          .join("")}
      </select>
      <p class="field__error" id="reminder-error-service" hidden></p>
    </div>`
    : "";

  const dateSection = watchesDate
    ? synced
      ? `
    <div class="field">
      <label class="field__label" for="reminder-date">${t("reminders.dueDateLabel")}</label>
      <input class="field__input" id="reminder-date" type="text" readonly
        value="${syncDate != null ? escHtml(formatDate(syncDate)) : ""}" />
      ${syncDate == null ? `<p class="field__hint">${t("reminders.syncDateUnavailableHint")}</p>` : ""}
      <p class="field__error" id="reminder-error-date" hidden></p>
    </div>`
      : `
    <div class="field">
      <label class="field__label" for="reminder-date">${t("reminders.dueDateLabel")}${isGeneralMode ? "" : ""}</label>
      ${dateFieldHtml({
        fieldId: "reminder-date",
        name: "dueDate",
        value: fieldValue("dueDate"),
        label: t("reminders.dueDateLabel"),
      })}
      ${isGeneralMode ? `<p class="field__hint">${t("reminders.dateOptionalHint")}</p>` : ""}
      <p class="field__error" id="reminder-error-date" hidden></p>
    </div>`
    : "";

  const kmSection = watchesKm
    ? synced
      ? `
    <div class="field">
      <label class="field__label" for="reminder-km">${t("reminders.dueMileageLabel")}</label>
      <input class="field__input" id="reminder-km" type="text" readonly
        value="${syncKm != null ? escHtml(faNum(syncKm)) : ""}" />
      ${syncKm == null ? `<p class="field__hint">${t("reminders.syncKmUnavailableHint")}</p>` : ""}
      <p class="field__error" id="reminder-error-km" hidden></p>
    </div>`
      : `
    <div class="field">
      <label class="field__label" for="reminder-km">${t("reminders.dueMileageLabel")}</label>
      <input class="field__input" id="reminder-km" name="dueMileage" type="number"
        inputmode="numeric" min="0" step="1"
        value="${escHtml(fieldValue("dueMileage"))}" />
      ${vehicle?.currentOdometer != null ? `<p class="field__hint">${t("reminders.currentOdometerHint")} ${faNum(vehicle.currentOdometer)} ${t("common.kmUnit")}</p>` : ""}
      <p class="field__error" id="reminder-error-km" hidden></p>
    </div>`
    : "";

  // Advance-reminder fields (Req 1): at most ONE per kind, and they are
  // ALWAYS in the DOM (no injection on toggle) so the layout never jumps —
  // while اعلان پیش از موعد is OFF they render DISABLED and the submit
  // path skips them (a disabled input is also absent from FormData). An
  // empty field simply means no advance for that kind. Reuses the Services
  // form's affix-field input pattern (label + input + unit suffix inside).
  const advanceDaysField = watchesDate
    ? `
    <div class="field">
      <label class="field__label" for="reminder-advance-days">${t("reminders.advanceDaysLabel")}</label>
      <div class="affix-field">
        <input class="field__input affix-field__input" id="reminder-advance-days" name="advanceDays" type="number"
          inputmode="numeric" min="0" step="1" ${state.formNotifications ? "" : "disabled"}
          value="${escHtml(fieldValue("advanceDays"))}" />
        <span class="affix-field__suffix">${t("reminders.daysBefore")}</span>
      </div>
    </div>`
    : "";

  const advanceKmField = watchesKm
    ? `
    <div class="field">
      <label class="field__label" for="reminder-advance-km">${t("reminders.advanceKmLabel")}</label>
      <div class="affix-field">
        <input class="field__input affix-field__input" id="reminder-advance-km" name="advanceKm" type="number"
          inputmode="numeric" min="0" step="1" ${state.formNotifications ? "" : "disabled"}
          value="${escHtml(fieldValue("advanceKm"))}" />
        <span class="affix-field__suffix">${t("reminders.kmBefore")}</span>
      </div>
    </div>`
    : "";

  // True while the تکرار toggle is OFF: the whole repeat group renders
  // visible-but-disabled (no-repeat = toggle off, so nothing is submitted).
  const repeatDisabled = state.formRepeat === "none";

  // Day-of-week select — always visible on the general form so the layout
  // never jumps. Enabled only for repeat "weekly"; disabled for every other
  // repeat mode (and while the تکرار toggle is OFF). Switching away from
  // weekly clears the stored weekday so a disabled value is never used.
  const weekdayDisabled = state.formRepeat !== "weekly";
  const weekdayField =
    isGeneralMode && watchesDate
      ? `
    <div class="field">
      <label class="field__label" for="reminder-weekday">${t("reminders.weekdayLabel")}</label>
      <select class="field__input js-reminder-weekday" id="reminder-weekday"
        ${weekdayDisabled ? "disabled" : ""}>
        ${WEEKDAY_KEYS.map(
          (key, index) => `
        <option value="${index}" ${state.formWeekday === index ? "selected" : ""}>${t(key)}</option>`,
        ).join("")}
      </select>
      <p class="field__error" id="reminder-error-repeat-weekday" hidden></p>
    </div>`
      : "";

  return `
    <div class="modal-overlay">
      <div class="modal modal--scroll" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
        <form id="reminder-form" class="form" novalidate>
          <div class="form__title">${escHtml(title)}</div>

          <div class="field">
            <label class="field__label" for="reminder-title">${t("reminders.titleLabel")}</label>
            <input class="field__input" id="reminder-title" name="title" type="text"
              ${synced ? "readonly" : ""}
              value="${escHtml(syncedServiceName ?? fieldValue("title"))}"
              placeholder="${t("reminders.titlePlaceholder")}" />
            <p class="field__error" id="reminder-error-title" hidden></p>
          </div>

          ${serviceSelectField}

          ${!isGeneralMode && (serviceLinked != null || fieldValue("serviceId") !== "") ? `
          <div class="field field--static">
            <label class="toggle-row">
              <span class="toggle-row__label">${t("reminders.syncToggleLabel")}</span>
              <span class="toggle">
                <input type="checkbox" class="js-reminder-sync-toggle" role="switch"
                  aria-label="${t("reminders.syncToggleLabel")}" ${state.formSynced ? "checked" : ""} />
                <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
              </span>
            </label>
            ${synced ? `<p class="field__hint reminder-sync-hint">${t("reminders.syncHint")}</p>` : ""}
          </div>` : ""}

          <!-- Reminder type group: segmented control + dynamic hint. Only for service reminders. -->
          ${!isGeneralMode ? `
          <div class="field form__gap--1">
            <span class="field__label" id="reminder-type-label">${t("reminders.typeLabel")}</span>
            <div class="settings-theme segmented" role="radiogroup" aria-labelledby="reminder-type-label">
              ${typeOptions
                .map(
                  (option) => `
                <button type="button" class="segmented__option js-reminder-type ${state.formType === option.value ? "segmented__option--active" : ""}"
                  data-type="${option.value}" role="radio" aria-checked="${state.formType === option.value}">
                  ${t(option.key)}
                </button>`,
                )
                .join("")}
            </div>
            <p class="field__hint">${t(typeHintKey[state.formType])}</p>
          </div>` : ""}

          ${dateSection}
          ${kmSection}

          <!-- Advance notification group: toggle + ALWAYS-present config
               fields. OFF = fields disabled (never submitted); ON = enabled.
               Nothing is injected/removed, so the layout stays stable. -->
          <div class="field field--static form__gap--2">
            <label class="toggle-row">
              <span class="toggle-row__label">${t("reminders.notifyBeforeLabel")}</span>
              <span class="toggle">
                <input type="checkbox" name="notifyBefore" value="1" class="js-notifications-toggle"
                  role="switch" aria-label="${t("reminders.notifyBeforeLabel")}" ${state.formNotifications ? "checked" : ""} />
                <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
              </span>
            </label>
          </div>
          <div class="field field--static">
            ${advanceDaysField}
            ${advanceKmField}
            <p class="field__error" id="reminder-error-offsets" hidden></p>
          </div>

          <!-- Repeat group: only for general reminders. -->
          ${isGeneralMode ? `
          <div class="field field--static form__gap--3">
            <label class="toggle-row">
              <span class="toggle-row__label">${t("reminders.repeatLabel")}</span>
              <span class="toggle">
                <input type="checkbox" class="js-reminder-repeat-toggle" role="switch"
                  aria-label="${t("reminders.repeatLabel")}" ${repeatDisabled ? "" : "checked"} />
                <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
              </span>
            </label>
          </div>
          <div class="field field--static">
            <div class="repeat-row">
              <div class="field">
                <label class="field__label" for="reminder-repeat">${t("reminders.repeatIntervalLabel")}</label>
                <select class="field__input js-reminder-repeat" id="reminder-repeat"
                  ${repeatDisabled ? "disabled" : ""}>
                  ${repeatOptions
                    .map(
                      (option) => `
                <option value="${option.value}" ${state.formRepeat === option.value ? "selected" : ""}>${t(option.key)}</option>`,
                    )
                    .join("")}
                </select>
              </div>
              ${weekdayField}
            </div>
          </div>` : ""}

          <!-- Description field: at end for both general and service reminders -->
          <div class="field">
            <label class="field__label" for="reminder-description">${t("reminders.descriptionLabel")}</label>
            <textarea class="field__input" id="reminder-description" name="description" rows="2"
              placeholder="${t("reminders.descriptionPlaceholder")}">${escHtml(fieldValue("description"))}</textarea>
          </div>

          <div class="form__actions">
            ${editing ? `
            <button type="button" class="btn btn--danger-text reminder-form__delete js-reminder-delete">
              <span data-lucide="trash-2" aria-hidden="true"></span>
              ${t("reminders.deleteTitle")}
            </button>` : ""}
            <div class="reminder-form__actions-main">
              <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
              <button type="submit" class="btn btn--filled">${t("common.save")}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}

function deleteConfirmModalHtml(): string {
  const reminder = store.get().reminders.find((r) => r.id === state.deleteConfirmId);
  if (!reminder) return "";
  return `
    <div class="modal-overlay">
      <div class="modal" role="alertdialog" aria-modal="true" aria-label="${t("reminders.deleteTitle")}">
        <div class="form">
          <div class="form__title">${t("reminders.deleteTitle")}</div>
          <div class="box box--danger" role="alert">
            <span data-lucide="triangle-alert"></span>
            <span>${t("reminders.deleteConfirm")} «${escHtml(reminder.title)}»</span>
          </div>
          <div class="form__actions">
            <button type="button" class="btn btn--text js-cancel-reminder-delete">${t("common.cancel")}</button>
            <button type="button" class="btn btn--danger js-confirm-reminder-delete" data-id="${escHtml(reminder.id)}">
              ${t("reminders.deleteTitle")}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** First-notification permission prompt (Phase 7) — CarBook modal style. */
function permissionPromptModalHtml(): string {
  return `
    <div class="modal-overlay">
      <div class="modal" role="alertdialog" aria-modal="true" aria-label="${t("notifications.promptTitle")}">
        <div class="form">
          <div class="form__title">${t("notifications.promptTitle")}</div>
          <div class="box box--warn" role="note">
            <span data-lucide="bell"></span>
            <span>${t("notifications.promptBody")}</span>
          </div>
          <div class="form__actions">
            <button type="button" class="btn btn--text js-permission-later">${t("notifications.promptLater")}</button>
            <button type="button" class="btn btn--filled js-permission-enable">
              <span data-lucide="bell"></span>
              ${t("notifications.promptEnable")}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* --- Form open/close + prefill (Phase 6) --- */

function closeForm(): void {
  state.form = null;
  state.formValues = {};
  state.formType = "date";
  state.formRepeat = "none";
  state.formWeekday = null;
  state.formNotifications = false;
  state.formSynced = false;
}

/**
 * Opens the add form with a service's derivable facts pre-filled (Phase 6):
 * title from the service name; due mileage from lastService.odometer +
 * intervalKm; due date from lastService.date + intervalMonths. Only
 * RELIABLY derivable values are set — anything missing stays empty.
 */
function openAddForm(prefill: ReminderPrefill | null): void {
  closeForm();
  state.form = { mode: "add", prefill };
  state.formType = prefill?.dueDate != null && prefill.dueMileage != null ? "date_mileage" : prefill?.dueMileage != null ? "mileage" : "date";
  state.formRepeat = "none";
  state.formWeekday = null;
  // Notifications are OFF by default (Req 4) — the user opts in; the
  // advance fields prefill sensible defaults the moment the toggle is on.
  state.formNotifications = false;
  // Service-based forms start SYNCHRONIZED (toggle ON): the service's
  // current recommendation fills both fields read-only.
  state.formSynced = prefill?.synced ?? false;
  if (prefill != null) {
    if (prefill.title !== "") state.formValues.title = prefill.title;
    if (prefill.dueDate != null) state.formValues.dueDate = prefill.dueDate;
    if (prefill.dueMileage != null) state.formValues.dueMileage = String(prefill.dueMileage);
  }
}

/**
 * Opens the General Reminder form — no service linkage, no type selection.
 * Date is optional, repeat functionality is available.
 */
function openGeneralReminderForm(prefill: ReminderPrefill | null): void {
  closeForm();
  state.form = { mode: "add", prefill };
  state.formType = "date"; // General reminders are date-based by default
  state.formRepeat = "none";
  state.formWeekday = null;
  state.formNotifications = false;
  state.formSynced = false; // Never synced for general reminders
  state.formMode = "general";
  if (prefill != null) {
    if (prefill.title !== "") state.formValues.title = prefill.title;
    if (prefill.dueDate != null) state.formValues.dueDate = prefill.dueDate;
  }
}

/**
 * Opens the Service Reminder form — requires service selection, no repeat.
 * The user selects a service and then the reminder basis (date/mileage/both).
 */
function openServiceReminderForm(prefill: ReminderPrefill | null): void {
  closeForm();
  state.form = { mode: "add", prefill };
  // Type follows what the service currently provides (same rule as selecting
  // a service in the form): both → date+mileage, one → that one, neither → date.
  state.formType =
    prefill?.dueDate != null && prefill.dueMileage != null
      ? "date_mileage"
      : prefill?.dueMileage != null
        ? "mileage"
        : "date";
  state.formRepeat = "none"; // No repeat for service reminders
  state.formWeekday = null;
  state.formNotifications = false;
  state.formSynced = prefill?.synced ?? false; // Use synced from prefill (true when from Service Details)
  state.formMode = "service";
  if (prefill != null) {
    if (prefill.title !== "") state.formValues.title = prefill.title;
    if (prefill.dueDate != null) state.formValues.dueDate = prefill.dueDate;
    if (prefill.dueMileage != null) state.formValues.dueMileage = String(prefill.dueMileage);
    if (prefill.serviceId != null) state.formValues.serviceId = prefill.serviceId;
  }
}

/**
 * Prefill for the SERVICE-BASED form (service page → یادآوری): title from
 * the service name, due values from the service's CURRENT next-recommended
 * schedule — only what the service actually provides, never invented. The
 * initial type follows the available data (openAddForm derives it from the
 * values): both → date+mileage, one → that one, neither → date (the form
 * then shows a clear "unavailable" state instead of an invalid reminder).
 */
function serviceSyncedPrefill(item: MaintenanceItem, dataset: ReturnType<typeof store.get>): ReminderPrefill {
  const recommended = recommendedDueForService(item, dataset);
  return {
    vehicleId: item.vehicleId ?? "",
    serviceId: item.id,
    title: item.name,
    dueDate: recommended.dueDate,
    dueMileage: recommended.dueMileage,
    currentOdometer: dataset.vehicles.find((v) => v.id === item.vehicleId)?.currentOdometer ?? null,
    synced: true,
  };
}

/**
 * Deep links, consumed once per navigation:
 * - `#/reminders?service=<id>` — the service page's یادآوری action. Opens
 *   the EXISTING synchronized reminder for editing when one exists (never
 *   duplicates), otherwise the service-based add form.
 * - `#/reminders?edit=<id>` — opens one reminder's edit form (the service
 *   page's "بررسی یادآوری" action for manual reminders).
 * - `#/reminders?focus=<id>` — scrolls to + temporarily highlights one
 *   reminder's card (the service page's status label / "View" action);
 *   NO form is opened.
 * Consumed params are stripped from the URL so a refresh never re-opens
 * the form.
 */
function consumeReminderHash(): void {
  const dataset = store.get();
  const serviceId = remindersServiceIdFromHash(window.location.hash);
  if (serviceId != null) {
    const item = dataset.maintenanceItems.find((candidate) => candidate.id === serviceId);
    if (item != null) {
      if (item.vehicleId != null) state.selectedVehicleId = item.vehicleId;
      const existing = dataset.reminders.find(
        (reminder) => reminder.serviceId === serviceId && reminder.syncWithService,
      );
      if (existing != null) {
        openEditForm(existing.id);
      } else {
        // Open Service Reminder form with sync enabled by default
        const prefill = serviceSyncedPrefill(item, dataset);
        prefill.synced = true; // Enable sync by default when coming from Service Details
        openServiceReminderForm(prefill);
      }
    }
    clearReminderHashQuery();
    return;
  }
  const editId = remindersEditIdFromHash(window.location.hash);
  if (editId != null) {
    const reminder = dataset.reminders.find((candidate) => candidate.id === editId);
    if (reminder != null) {
      state.selectedVehicleId = reminder.vehicleId;
      openEditForm(reminder.id);
    }
    clearReminderHashQuery();
    return;
  }
  const focusId = remindersFocusIdFromHash(window.location.hash);
  if (focusId != null) {
    const reminder = dataset.reminders.find((candidate) => candidate.id === focusId);
    if (reminder != null) {
      state.selectedVehicleId = reminder.vehicleId;
      // Reset the filter so the target card is guaranteed to be rendered.
      state.filter = "all";
      state.focusReminderId = reminder.id;
    }
    clearReminderHashQuery();
  }
}

/** Strips view-action query params from the hash (replaceState: no re-render). */
function clearReminderHashQuery(): void {
  history.replaceState(null, "", `${location.pathname}${location.search}#/reminders`);
}

/**
 * Opens the edit form. Service-synchronized reminders display their
 * RESOLVED values — the service's current name and recommendation — not
 * the stored snapshot.
 */
function openEditForm(reminderId: string): void {
  const dataset = store.get();
  const stored = dataset.reminders.find((candidate) => candidate.id === reminderId);
  if (!stored) return;
  closeForm();
  state.form = { mode: "edit", reminderId: stored.id };
  const reminder = resolveReminder(stored, dataset);
  state.formType = reminder.type;
  // Determine form mode based on whether the reminder has a service association
  state.formMode = stored.serviceId != null ? "service" : "general";
  // The toggle reflects the STORED sync state; when ON the resolved values
  // display read-only, when OFF the stored snapshot values are editable.
  state.formSynced = stored.syncWithService;
  // The sync toggle controls ONLY the due date/km editability — repeat is
  // an independent setting and always loads (km repeat only exists on
  // date_mileage reminders, where the due mileage can advance).
  state.formRepeat = reminder.repeat === "km" && reminder.type === "date" ? "none" : reminder.repeat;
  state.formWeekday = reminder.repeatWeekday ?? defaultWeekdayFor(reminder.dueDate);
  const firstDays = reminder.notificationOffsets.find((offset) => offset.days != null);
  const firstKm = reminder.notificationOffsets.find((offset) => offset.km != null);
  state.formNotifications = reminder.notificationOffsets.length > 0;
  state.formValues = {
    title: reminder.title,
    description: reminder.description,
    dueDate: reminder.dueDate ?? "",
    dueMileage: reminder.dueMileage != null ? String(reminder.dueMileage) : "",
    advanceDays: firstDays?.days != null ? String(firstDays.days) : "",
    advanceKm: firstKm?.km != null ? String(firstKm.km) : "",
    repeatEveryKm: reminder.repeatEveryKm != null ? String(reminder.repeatEveryKm) : "",
    serviceId: stored.serviceId ?? "",
  };
}

/** True when this is the user's FIRST notification-enabled reminder save
 * and browser permission has not been decided yet (Phase 7). */
function needsPermissionPrompt(dataset: ReturnType<typeof store.get>, enabled: boolean): boolean {
  if (!enabled || !notificationsSupported()) return false;
  if (notificationPermission() !== "default") return false;
  return !dataset.reminders.some((reminder) => reminder.enabled);
}

/* --- Events --- */

function bind(container: HTMLElement): void {
  /* Vehicle menu (shared markup/behavior with Services). */
  container.querySelectorAll<HTMLButtonElement>(".js-vehicle-menu-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      state.vehicleMenuOpen = !state.vehicleMenuOpen;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLElement>(".js-vehicle-menu-close").forEach((el) => {
    el.addEventListener("click", () => {
      state.vehicleMenuOpen = false;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-vehicle-option").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.vehicleId ?? null;
      if (id) state.selectedVehicleId = id;
      state.vehicleMenuOpen = false;
      redraw(container);
    });
  });

  /* Filter menu. */
  container.querySelectorAll<HTMLButtonElement>(".js-filter-menu-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      state.filterMenuOpen = !state.filterMenuOpen;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLElement>(".js-filter-menu-close").forEach((el) => {
    el.addEventListener("click", () => {
      state.filterMenuOpen = false;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-filter-option").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.filter as ReminderViewState["filter"] | undefined;
      if (value) state.filter = value;
      state.filterMenuOpen = false;
      redraw(container);
    });
  });

  /* Add Reminder menu toggle — opens/closes the floating action menu.
   * Class is flipped directly (no full redraw) so the plus→× rotation
   * and menu expand/collapse CSS transitions can run. */
  container.querySelectorAll<HTMLButtonElement>(".js-add-menu-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      setAddMenuOpen(container, !state.addMenuOpen);
    });
  });

  /* Add Reminder menu close — closes when clicking the backdrop. */
  container.querySelectorAll<HTMLElement>(".js-add-menu-close").forEach((backdrop) => {
    backdrop.addEventListener("click", () => {
      setAddMenuOpen(container, false);
    });
  });

  /* General Reminder option — opens the general reminder form. */
  container.querySelectorAll<HTMLButtonElement>(".js-add-general-reminder").forEach((button) => {
    button.addEventListener("click", () => {
      state.addMenuOpen = false;
      const dataset = store.get();
      const vehicleId = resolveSelectedVehicleId(dataset);
      openGeneralReminderForm(
        vehicleId == null
          ? null
          : { vehicleId, serviceId: null, title: "", dueDate: null, dueMileage: null, currentOdometer: null, synced: false },
      );
      redraw(container);
    });
  });

  /* Service Reminder option — opens the service reminder form. */
  container.querySelectorAll<HTMLButtonElement>(".js-add-service-reminder").forEach((button) => {
    button.addEventListener("click", () => {
      state.addMenuOpen = false;
      const dataset = store.get();
      const vehicleId = resolveSelectedVehicleId(dataset);
      openServiceReminderForm(
        vehicleId == null
          ? null
          : { vehicleId, serviceId: null, title: "", dueDate: null, dueMileage: null, currentOdometer: null, synced: false },
      );
      redraw(container);
    });
  });

  /* Whole card opens the edit form — clicks/keys on the enable toggle or
   * the linked service keep their own behavior. */
  container.querySelectorAll<HTMLElement>(".js-reminder-card").forEach((card) => {
    const openEdit = (): void => {
      const id = card.dataset.id ?? null;
      if (id) {
        openEditForm(id);
        redraw(container);
      }
    };
    card.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a, .reminder-card__toggle")) return;
      openEdit();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if ((event.target as HTMLElement).closest("a, .reminder-card__toggle")) return;
      event.preventDefault();
      openEdit();
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-confirm-reminder-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id ?? "";
      state.deleteConfirmId = null;
      // Deleting from the edit form must close the form too — otherwise
      // the confirm modal would close onto a form for the removed reminder.
      closeForm();
      store.update((draft) => {
        draft.reminders = draft.reminders.filter((reminder) => reminder.id !== id);
      });
    });
  });

  /* Enable/disable straight from the card. */
  container.querySelectorAll<HTMLInputElement>(".js-reminder-toggle").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.id ?? "";
      const enabled = input.checked;
      store.update((draft) => {
        const reminder = draft.reminders.find((r) => r.id === id);
        if (reminder) {
          reminder.enabled = enabled;
          reminder.updatedAt = new Date().toISOString();
        }
      });
      runReminderCheck(store.get());
    });
  });

  /* Form modal. */
  const form = container.querySelector<HTMLFormElement>("#reminder-form");
  form?.addEventListener("input", captureFormValue);
  form?.addEventListener("change", captureFormValue);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitReminderForm(container, form);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-close-overlay").forEach((button) => {
    button.addEventListener("click", () => {
      closeForm();
      state.deleteConfirmId = null;
      redraw(container);
    });
  });

  /* Modal backdrop click - closes modal when clicking outside the content. */
  container.querySelectorAll<HTMLElement>(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      // Only close if clicking directly on the overlay, not on the modal content
      if (event.target === overlay) {
        closeForm();
        state.deleteConfirmId = null;
        state.permissionPrompt = null;
        redraw(container);
      }
    });
  });

  /* Delete action in the edit form: opens the confirmation dialog over
   * the still-open form (canceling returns to the form). */
  container.querySelectorAll<HTMLButtonElement>(".js-reminder-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const id = state.form?.mode === "edit" ? state.form.reminderId : null;
      if (!id) return;
      state.deleteConfirmId = id;
      redraw(container);
    });
  });
  /* Cancel of the delete confirmation: back to the edit form, untouched. */
  container.querySelectorAll<HTMLButtonElement>(".js-cancel-reminder-delete").forEach((button) => {
    button.addEventListener("click", () => {
      state.deleteConfirmId = null;
      redraw(container);
    });
  });

  /* Type segmented control + repeat/weekday selects. */
  container.querySelectorAll<HTMLButtonElement>(".js-reminder-type").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type as Reminder["type"] | undefined;
      if (!type || type === state.formType) return;
      state.formType = type;
      // Repeat is a date-based concept (Req 2): a pure mileage reminder
      // has no repeat section, and the km recurrence only exists for
      // date_mileage — clear the in-progress choice accordingly.
      if (type === "mileage" || (type === "date" && state.formRepeat === "km")) {
        state.formRepeat = "none";
        state.formWeekday = null;
      }
      redraw(container);
    });
  });
  /* تکرار toggle: OFF = no recurrence (config fields stay visible but
   * disabled — nothing submitted); ON resumes the last recurrence choice,
   * defaulting to daily. */
  container.querySelectorAll<HTMLInputElement>(".js-reminder-repeat-toggle").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        if (state.formRepeat === "none") state.formRepeat = "daily";
        if (state.formRepeat === "weekly" && state.formWeekday == null) {
          state.formWeekday = defaultWeekdayFor(fieldValue("dueDate") || null);
        }
      } else {
        // Keep the pending config in state so re-enabling restores it; the
        // submit path never reads it while the toggle is "none".
        state.formRepeat = "none";
      }
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLSelectElement>(".js-reminder-repeat").forEach((select) => {
    select.addEventListener("change", () => {
      const repeat = select.value as RepeatMode;
      state.formRepeat = repeat;
      // Weekly needs a day: default to the due date's weekday, else
      // Saturday. Switching away disables the selector and clears the value.
      state.formWeekday =
        repeat === "weekly" ? (state.formWeekday ?? defaultWeekdayFor(fieldValue("dueDate") || null)) : null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLSelectElement>(".js-reminder-weekday").forEach((select) => {
    select.addEventListener("change", () => {
      const weekday = Number(select.value);
      state.formWeekday = Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : null;
      redraw(container);
    });
  });

  /* Service selection dropdown (Service Reminder form from Reminders page) */
  container.querySelectorAll<HTMLSelectElement>(".js-reminder-service").forEach((select) => {
    select.addEventListener("change", () => {
      const serviceId = select.value || null;
      const dataset = store.get();
      
      if (serviceId != null) {
        const item = dataset.maintenanceItems.find((candidate) => candidate.id === serviceId);
        if (item != null) {
          // Populate form with service data and enable sync
          const prefill = serviceSyncedPrefill(item, dataset);
          prefill.synced = true; // Enable sync by default when service is selected
          state.formSynced = true;
          state.formValues.serviceId = serviceId;
          state.formValues.title = prefill.title;
          // Populate both date and mileage from service suggestions
          if (prefill.dueDate != null) state.formValues.dueDate = prefill.dueDate;
          if (prefill.dueMileage != null) state.formValues.dueMileage = String(prefill.dueMileage);
          // Update form type based on available data
          state.formType = prefill.dueDate != null && prefill.dueMileage != null ? "date_mileage" : prefill.dueMileage != null ? "mileage" : "date";
        }
      } else {
        // Clear service-specific data when no service selected
        state.formSynced = false;
        state.formValues.serviceId = "";
        state.formValues.title = "";
        state.formValues.dueDate = "";
        state.formValues.dueMileage = "";
        state.formType = "date";
      }
      redraw(container);
    });
  });

  /* اعلان پیش از موعد toggle (Req 4): the advance fields are ALWAYS in the
   * DOM — this only enables/disables them (OFF = disabled, never
   * submitted). Turning ON prefills sensible defaults so they are ready. */
  container.querySelectorAll<HTMLInputElement>(".js-notifications-toggle").forEach((input) => {
    input.addEventListener("change", () => {
      state.formNotifications = input.checked;
      if (input.checked) {
        if (fieldValue("advanceDays") === "") state.formValues.advanceDays = "7";
        if (fieldValue("advanceKm") === "") state.formValues.advanceKm = "100";
      }
      redraw(container);
    });
  });

  /* همگام با تعویض پیشنهادی toggle (service-based forms): ON keeps the
   * service as the source of truth (fields read-only from its live
   * recommendation); OFF seeds the editable fields with the CURRENT
   * resolved values so nothing is lost, and the reminder saves manual. */
  container.querySelectorAll<HTMLInputElement>(".js-reminder-sync-toggle").forEach((input) => {
    input.addEventListener("change", () => {
      state.formSynced = input.checked;
      if (!input.checked) {
        // Seed the editable fields from the service's current
        // recommendation (what the user saw while synced) — only the
        // sides the service actually provides; missing sides stay empty.
        const dataset = store.get();
        const form = state.form;
        const serviceId =
          form == null
            ? null
            : form.mode === "edit"
              ? (dataset.reminders.find((r) => r.id === form.reminderId)?.serviceId ?? null)
              : (form.prefill?.serviceId ?? fieldValue("serviceId") ?? null);
        if (serviceId != null) {
          const item = dataset.maintenanceItems.find((candidate) => candidate.id === serviceId);
          if (item) {
            const recommended = recommendedDueForService(item, dataset);
            if (recommended.dueDate != null) state.formValues.dueDate = recommended.dueDate;
            if (recommended.dueMileage != null) {
              state.formValues.dueMileage = String(recommended.dueMileage);
            }
          }
        }
      }
      redraw(container);
    });
  });

  /* Permission prompt (Phase 7). */
  container.querySelector<HTMLButtonElement>(".js-permission-enable")?.addEventListener("click", () => {
    const pending = state.permissionPrompt?.pendingReminder;
    state.permissionPrompt = null;
    if (!pending) {
      redraw(container);
      return;
    }
    void (async () => {
      const { requestNotificationPermission } = await import("../domain/reminder-checker");
      const permission = await requestNotificationPermission();
      if (permission === "denied") {
        state.permissionNotice = t("notifications.promptDeniedNote");
      }
      saveReminder(pending.reminder);
      redraw(container);
    })();
  });
  container.querySelector<HTMLButtonElement>(".js-permission-later")?.addEventListener("click", () => {
    const pending = state.permissionPrompt?.pendingReminder;
    state.permissionPrompt = null;
    if (pending) {
      saveReminder(pending.reminder);
      state.permissionNotice = t("notifications.promptLaterNote");
    }
    redraw(container);
  });

  /* Dismiss the "فعلاً نه" notice. */
  container.querySelector<HTMLButtonElement>(".js-dismiss-notice")?.addEventListener("click", () => {
    state.permissionNotice = null;
    redraw(container);
  });
}

/** Builds a Reminder from the form, validates, then saves (Phase 5+7). */
function submitReminderForm(container: HTMLElement, form: HTMLFormElement): void {
  const dataset = store.get();
  const formState = state.form;
  if (!formState) return;
  const vehicleId = resolveSelectedVehicleId(dataset);
  if (vehicleId == null) return;

  const editing = formState.mode === "edit";
  const editingReminder = editing
    ? (dataset.reminders.find((r) => r.id === formState.reminderId) ?? null)
    : null;
  // The toggle's LIVE state decides the flow: ON = service-synchronized
  // (values re-resolve from the service at save); OFF = manual reminder
  // that KEEPS its serviceId reference (بررسی یادآوری still finds it) and
  // uses the editable field values. A manual form never sets serviceId.
  const synced = editing
    ? (editingReminder?.serviceId != null && state.formSynced)
    : (formState.prefill?.synced ?? false) && state.formSynced;
  const serviceId = synced
    ? (editing ? editingReminder?.serviceId ?? null : formState.prefill?.serviceId ?? null)
    : editing
      ? (editingReminder?.serviceId ?? null)
      : (formState.prefill?.serviceId ?? null);

  const data = new FormData(form);
  // A synced reminder mirrors the service's current name; an unsynced one
  // uses whatever the (editable) title field holds.
  const title = synced
    ? (serviceId != null
        ? (dataset.maintenanceItems.find((candidate) => candidate.id === serviceId)?.name ?? String(data.get("title") ?? "").trim())
        : String(data.get("title") ?? "").trim())
    : String(data.get("title") ?? "").trim();
  const description = String(data.get("description") ?? "").trim();

  // Service-synchronized saves re-resolve the due values from the service
  // at save time (req 7) — a stale form value can never be persisted, and
  // the validation catches a service that cannot provide a required value.
  const syncRecommended = (() => {
    if (serviceId == null) return null;
    const item = dataset.maintenanceItems.find((candidate) => candidate.id === serviceId);
    return item ? recommendedDueForService(item, dataset) : null;
  })();

  const dateRaw = String(data.get("dueDate") ?? "").trim();
  const dueDate = synced
    ? (watchesDate() ? syncRecommended?.dueDate ?? null : null)
    : watchesDate() && dateRaw !== ""
      ? dateRaw
      : null;
  const kmRaw = String(data.get("dueMileage") ?? "").trim();
  const dueMileage = synced
    ? (watchesKm() ? syncRecommended?.dueMileage ?? null : null)
    : watchesKm() && kmRaw !== ""
      ? Number(toLatinDigits(kmRaw))
      : null;
  // Repeat is an independent setting in BOTH flows: the toggle only gates
  // the due date/km editability, never the recurrence controls.
  const repeatEveryKmRaw = String(data.get("repeatEveryKm") ?? "").trim();
  const repeatEveryKm = state.formRepeat === "km" && repeatEveryKmRaw !== "" ? Number(toLatinDigits(repeatEveryKmRaw)) : null;

  /* Reminders are saved ENABLED (Req 5) — the user toggles enable/disable
   * later from the card in the list, which is the existing pattern. */
  const enabled = true;

  // Advance reminders: AT MOST ONE per kind (Req 1) — built straight from
  // the two fixed fields; an empty field = no advance for that kind.
  const notificationOffsets: NotificationOffset[] = [];
  if (state.formNotifications) {
    const daysRaw = String(data.get("advanceDays") ?? "").trim();
    const kmRaw = String(data.get("advanceKm") ?? "").trim();
    if (watchesDate() && daysRaw !== "") notificationOffsets.push({ days: Number(toLatinDigits(daysRaw)) });
    if (watchesKm() && kmRaw !== "") notificationOffsets.push({ km: Number(toLatinDigits(kmRaw)) });
  }

  const draft = {
    vehicleId,
    title,
    description,
    serviceId,
    synced,
    type: state.formType,
    dueDate,
    dueMileage,
    notificationOffsets,
    repeat: state.formRepeat,
    // The weekday only applies to repeat "weekly" — cleared otherwise.
    repeatWeekday: state.formRepeat === "weekly" ? state.formWeekday : null,
    repeatEveryKm,
    enabled,
  };

  const errors = validateReminderDraft(draft);
  if (errors.length > 0) {
    showReminderErrors(container, errors.map((error) => [error, t(ERROR_KEYS[error])]));
    return;
  }

  const now = new Date().toISOString();
  // The draft's `synced` flag is form-level validation input, not a stored
  // field — the persisted Reminder carries only `syncWithService`.
  const { synced: _draftSynced, ...draftFields } = draft;
  const reminder: Reminder = editing
    ? {
        ...((dataset.reminders.find((r) => r.id === formState.reminderId) as Reminder) ?? { id: createId() }),
        ...draftFields,
        syncWithService: synced,
        updatedAt: now,
      }
    : {
        id: createId(),
        ...draftFields,
        syncWithService: synced,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        createdAt: now,
        updatedAt: now,
      };

  closeForm();
  if (!editing && needsPermissionPrompt(dataset, notificationOffsets.length > 0)) {
    // First reminder with CONFIGURED notifications: ask BEFORE saving
    // (Phase 7) — gated on the اعلان پیش از موعد toggle plus actual
    // offsets, never on app start or plain browsing.
    state.permissionPrompt = { pendingReminder: { reminder, wantsNotifications: true } };
    redraw(container);
    return;
  }
  saveReminder(reminder);
  redraw(container);
}

function watchesDate(): boolean {
  return state.formType === "date" || state.formType === "date_mileage";
}

function watchesKm(): boolean {
  return state.formType === "mileage" || state.formType === "date_mileage";
}

/** Persists a reminder, rolls recurrence if due, then runs the check. */
function saveReminder(reminder: Reminder): void {
  const editing = store.get().reminders.some((r) => r.id === reminder.id);
  store.update((draft) => {
    if (editing) {
      const index = draft.reminders.findIndex((r) => r.id === reminder.id);
      if (index >= 0) draft.reminders[index] = reminder;
    } else {
      draft.reminders.push(reminder);
    }
    // Recurring reminders whose occurrence already completed roll forward
    // immediately (created/edited after the due point) — no duplicates.
    advanceRecurringReminders(draft, todayIso());
  });
  runReminderCheck(store.get());
}

function showReminderErrors(container: HTMLElement, errors: [ReminderDraftError, string][]): void {
  const FIELD: Partial<Record<ReminderDraftError, string>> = {
    titleRequired: "reminder-error-title",
    dueDateRequired: "reminder-error-date",
    dueDateInvalid: "reminder-error-date",
    dueMileageRequired: "reminder-error-km",
    dueMileageInvalid: "reminder-error-km",
    syncDateUnavailable: "reminder-error-date",
    syncKmUnavailable: "reminder-error-km",
    repeatWeekdayInvalid: "reminder-error-repeat-weekday",
    repeatKmRequired: "reminder-error-repeat-km",
    repeatKmInvalid: "reminder-error-repeat-km",
    offsetInvalid: "reminder-error-offsets",
    conditionRequired: "reminder-error-date",
  };
  for (const [error, message] of errors) {
    const id = FIELD[error];
    if (id == null) continue;
    const element = container.querySelector<HTMLElement>(`#${id}`);
    if (element) {
      element.textContent = message;
      element.hidden = false;
    }
  }
}

/**
 * Paints the view into the container and re-binds events. The innerHTML
 * swap destroys the open modal's scroll container, so both the modal
 * overlay's scrollTop and the window's scrollY are captured first and
 * restored after — toggling any switch in the form never jumps the view
 * back to the top.
 */
function paintView(container: HTMLElement): void {
  const pageScroll = window.scrollY;
  const overlay = container.querySelector<HTMLElement>(".modal-overlay");
  const overlayScroll = overlay?.scrollTop ?? null;

  container.innerHTML = remindersViewHtml();
  bind(container);
  applyIcons();
  bindFloatingFields(container);
  bindDateFields(container);
  alignFabBar();
  applyFocusHighlight(container);

  if (overlayScroll != null) {
    const freshOverlay = container.querySelector<HTMLElement>(".modal-overlay");
    if (freshOverlay) freshOverlay.scrollTop = overlayScroll;
  }
  window.scrollTo(0, pageScroll);
}

/** Re-renders without notifying the store (view-local transitions). */
function redraw(container: HTMLElement): void {
  paintView(container);
}

/**
 * Scrolls to the focused reminder's card (set by `#/reminders?focus=<id>`)
 * and applies a temporary highlight so the user immediately identifies it.
 * Re-applies safely if a redraw wipes the class mid-pulse; the highlight
 * clears itself after ~2.4s and the state is dropped.
 */
let focusTimer: number | null = null;
function applyFocusHighlight(container: HTMLElement): void {
  const id = state.focusReminderId;
  if (id == null) return;
  const card = container.querySelector<HTMLElement>(`.reminder-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return; // not rendered (yet) — keep the state for a later draw
  if (card.classList.contains("reminder-card--focus")) return; // already pulsing
  card.classList.add("reminder-card--focus");
  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  const focusId = id;
  if (focusTimer != null) window.clearTimeout(focusTimer);
  focusTimer = window.setTimeout(() => {
    focusTimer = null;
    card.classList.remove("reminder-card--focus");
    if (state.focusReminderId === focusId) state.focusReminderId = null;
  }, 2400);
}
