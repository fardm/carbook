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
  requestNotificationPermission,
  runReminderCheck,
  advanceRecurringReminders,
} from "../domain/reminder-checker";
import { todayIso } from "../domain/calendar";
import { formatDate } from "../domain/calendar/format";
import { createId } from "../domain/ids";
import type {
  NotificationOffset,
  Reminder,
  RepeatMode,
  Vehicle,
} from "../domain/types";
import { t } from "../i18n";
import { store } from "../state/store";
import { faNum, toLatinDigits } from "../ui/format";
import { bindDateFields, dateFieldHtml } from "../ui/date-field";
import { escHtml } from "../ui/escape";
import { alignFabBar } from "../ui/fab";
import { bindFloatingFields } from "../ui/floating-field";
import { applyIcons } from "../ui/icons";
import {
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
  /** Configured notification offsets while the form is open. */
  offsets: NotificationOffset[];
  /** Which reminder type the form currently shows. */
  formType: Reminder["type"];
  /** Which repeat mode the form currently shows. */
  formRepeat: RepeatMode;
  /** Reminder whose card menu is open. */
  menuReminderId: string | null;
  /** Filter dropdown popover is open. */
  filterMenuOpen: boolean;
  /** Reminder pending deletion (confirm modal). */
  deleteConfirmId: string | null;
  /** First-notification permission prompt (Phase 7). */
  permissionPrompt: { pendingReminder: PendingReminder } | null;
  /** Info note after saving without browser permission ("فعلاً نه"). */
  permissionNotice: string | null;
  /** Vehicle picker popover is open. */
  vehicleMenuOpen: boolean;
}

/** Values carried from a service into the add form (Phase 6). */
interface ReminderPrefill {
  vehicleId: string;
  serviceId: string | null;
  title: string;
  dueDate: string | null;
  dueMileage: number | null;
  /** Vehicle's current odometer at prefill time, for the hint row. */
  currentOdometer: number | null;
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
  offsets: [],
  formType: "date",
  formRepeat: "none",
  deleteConfirmId: null,
  menuReminderId: null,
  filterMenuOpen: false,
  permissionPrompt: null,
  permissionNotice: null,
  vehicleMenuOpen: false,
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
  repeatKmRequired: "reminders.errorRepeatKmRequired",
  repeatKmInvalid: "reminders.errorRepeatKmInvalid",
  offsetInvalid: "reminders.errorOffsetInvalid",
  noOffsets: "reminders.errorNoOffsets",
};

/** Status chip styling reuses the existing maintenance status classes. */
const STATUS_CHIP_CLASS: Record<ReminderStatus, string> = {
  upcoming: "status-chip--upcoming",
  dueSoon: "status-chip--dueSoon",
  dueToday: "status-chip--due",
  due: "status-chip--due",
  overdue: "status-chip--overdue",
  disabled: "status-chip--inactive",
};

const STATUS_ICON: Record<ReminderStatus, string> = {
  upcoming: "calendar-arrow-up",
  dueSoon: "clock",
  dueToday: "calendar-clock",
  due: "calendar-clock",
  overdue: "triangle-alert",
  disabled: "circle",
};

const STATUS_LABEL_KEY: Record<ReminderStatus, Parameters<typeof t>[0]> = {
  upcoming: "reminders.statusUpcoming",
  dueSoon: "reminders.statusDueSoon",
  dueToday: "reminders.statusDueToday",
  due: "reminders.statusDue",
  overdue: "reminders.statusOverdue",
  disabled: "reminders.statusDisabled",
};

export function renderReminders(container: HTMLElement): () => void {
  const draw = (): void => {
    activeContainer = container;
    container.innerHTML = remindersViewHtml();
    bind(container);
    applyIcons();
    bindFloatingFields(container);
    bindDateFields(container);
    alignFabBar();
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
    if (state.form || state.deleteConfirmId) {
      closeForm();
      redraw(container);
      return;
    }
    if (state.vehicleMenuOpen) {
      state.vehicleMenuOpen = false;
      redraw(container);
      return;
    }
    if (state.menuReminderId) {
      state.menuReminderId = null;
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

  return `
    <div class="view-stack view-stack--fab">
      <div class="page-header">
        <h1 class="view-title">${t("view.reminders.title")}</h1>
      </div>
      <div class="services-toolbar-row">${toolbar}</div>
      ${body}
      ${overlay}
    </div>
  `;
}

/** Toolbar: the SAME vehicle selector as Services + the add action. */
function remindersToolbarHtml(dataset: ReturnType<typeof store.get>, selectedId: string | null): string {
  const noVehicles = dataset.vehicles.length === 0;
  const addButton = `
    <button type="button" class="btn btn--filled js-add-reminder services-toolbar__add"
      ${noVehicles ? "disabled" : ""}>
      <span data-lucide="plus"></span>
      ${t("reminders.addReminder")}
    </button>`;
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
  const evaluated = reminders.map((reminder) => ({
    reminder,
    evaluation: evaluateReminder(reminder, vehicle?.currentOdometer ?? null),
  }));

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
function reminderScheduleLines(reminder: Reminder, vehicle: Vehicle | null): string[] {
  const lines: string[] = [];
  const days = remainingDays(reminder);
  const km = remainingKm(reminder, vehicle?.currentOdometer ?? null);

  if (reminder.dueDate != null) {
    const suffix =
      days == null ? "" : days >= 0 ? t("reminders.remainingDays") : t("reminders.pastDays");
    const remaining = days == null ? "" : ` — ${faNum(Math.abs(days))} ${suffix}`;
    lines.push(`${formatDate(reminder.dueDate)}${remaining}`);
  }
  if (reminder.dueMileage != null) {
    const suffix =
      km == null ? "" : km >= 0 ? t("reminders.remainingKm") : t("reminders.pastKm");
    const remaining = km == null ? "" : ` — ${faNum(Math.abs(km))} ${suffix}`;
    lines.push(`${faNum(reminder.dueMileage)} ${t("common.kmUnit")}${remaining}`);
  }
  return lines;
}

function reminderCardHtml(reminder: Reminder, vehicle: Vehicle | null, dataset: ReturnType<typeof store.get>): string {
  const evaluation = evaluateReminder(reminder, vehicle?.currentOdometer ?? null);
  const service = reminder.serviceId
    ? (dataset.maintenanceItems.find((item) => item.id === reminder.serviceId) ?? null)
    : null;
  const schedule = reminderScheduleLines(reminder, vehicle);

  const typeIcon = reminder.type === "mileage" ? "gauge" : reminder.type === "date_mileage" ? "calendar-clock" : "calendar";

  const repeatLabel =
    reminder.repeat === "monthly"
      ? t("reminders.repeatMonthly")
      : reminder.repeat === "yearly"
        ? t("reminders.repeatYearly")
        : reminder.repeat === "km"
          ? `${t("reminders.repeatKm")}: ${faNum(reminder.repeatEveryKm ?? 0)} ${t("common.kmUnit")}`
          : null;

  return `
    <article class="card service-card reminder-card${reminder.enabled ? "" : " reminder-card--disabled"}">
      <div class="service-card__head">
        <span class="service-card__icon" data-lucide="${typeIcon}"></span>
        <div class="service-card__info">
          <div class="service-card__name">${escHtml(reminder.title)}</div>
          ${
            service
              ? `<div class="reminder-card__service"><span data-lucide="link"></span>${escHtml(service.name)}</div>`
              : ""
          }
        </div>
        <span class="status-chip ${STATUS_CHIP_CLASS[evaluation.status]}">
          <span data-lucide="${STATUS_ICON[evaluation.status]}"></span>
          ${t(STATUS_LABEL_KEY[evaluation.status])}
        </span>
      </div>
      <div class="service-card__body reminder-card__body">
        <div class="service-card__detail reminder-card__detail">
          ${schedule.map((line) => `<div class="metric service-card__last"><span data-lucide="${line.includes("—") ? "activity" : "calendar"}"></span>${escHtml(line)}</div>`).join("")}
          ${repeatLabel ? `<div class="metric service-card__last"><span data-lucide="repeat"></span>${escHtml(repeatLabel)}</div>` : ""}
        </div>
        <label class="toggle reminder-card__toggle" title="${t("reminders.enabledLabel")}">
          <input type="checkbox" class="js-reminder-toggle" data-id="${escHtml(reminder.id)}"
            role="switch" aria-label="${t("reminders.enabledLabel")}" ${reminder.enabled ? "checked" : ""} />
          <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
        </label>
      </div>
      ${
        reminder.description.trim() !== ""
          ? `<p class="reminder-card__description">${escHtml(reminder.description)}</p>`
          : ""
      }
      ${reminderMenuHtml(reminder.id)}
    </article>
  `;
}

/** Three-dot menu (ویرایش / حذف) — the same dropdown used on service cards. */
function reminderMenuHtml(reminderId: string): string {
  const open = state.menuReminderId === reminderId;
  return `
    <div class="card-menu service-card-menu">
      <button type="button" class="icon-btn js-reminder-menu-toggle" data-id="${escHtml(reminderId)}"
        aria-haspopup="menu" aria-expanded="${open}"
        aria-label="${t("reminders.menuLabel")}" title="${t("reminders.menuLabel")}">
        <span data-lucide="more-vertical"></span>
      </button>
      ${
        open
          ? `
        <div class="card-menu__backdrop js-reminder-menu-backdrop"></div>
        <div class="card-menu__popover" role="menu" aria-label="${t("reminders.menuLabel")}">
          <button type="button" class="card-menu__item js-reminder-menu-edit" role="menuitem" data-id="${escHtml(reminderId)}">
            <span data-lucide="pencil"></span>
            ${t("reminders.editTitle")}
          </button>
          <div class="card-menu__divider" role="separator"></div>
          <button type="button" class="card-menu__item card-menu__item--danger js-reminder-menu-delete" role="menuitem" data-id="${escHtml(reminderId)}">
            <span data-lucide="trash-2"></span>
            ${t("reminders.deleteTitle")}
          </button>
        </div>`
          : ""
      }
    </div>
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
  const reminder = editing
    ? (dataset.reminders.find((r) => r.id === (state.form as { reminderId: string }).reminderId) ?? null)
    : null;
  const prefill = !editing && state.form?.mode === "add" ? state.form.prefill : null;
  const vehicle = vehicleId != null ? (dataset.vehicles.find((v) => v.id === vehicleId) ?? null) : null;
  const title = editing ? t("reminders.editTitle") : t("reminders.addTitle");

  // Services of the selected vehicle for the optional related-service select.
  const services = dataset.maintenanceItems.filter(
    (item) => item.vehicleId === vehicleId && item.active,
  );

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

  const repeatOptions: Array<{ value: RepeatMode; key: Parameters<typeof t>[0] }> = [
    { value: "none", key: "reminders.repeatNone" },
    { value: "monthly", key: "reminders.repeatMonthly" },
    { value: "yearly", key: "reminders.repeatYearly" },
    { value: "km", key: "reminders.repeatKm" },
  ];

  const watchesDate = state.formType === "date" || state.formType === "date_mileage";
  const watchesKm = state.formType === "mileage" || state.formType === "date_mileage";

  const dateSection = watchesDate
    ? `
    <div class="field">
      <label class="field__label" for="reminder-date">${t("reminders.dueDateLabel")}</label>
      ${dateFieldHtml({
        fieldId: "reminder-date",
        name: "dueDate",
        value: fieldValue("dueDate"),
        label: t("reminders.dueDateLabel"),
      })}
      <p class="field__error" id="reminder-error-date" hidden></p>
    </div>`
    : "";

  const kmSection = watchesKm
    ? `
    <div class="field">
      <label class="field__label" for="reminder-km">${t("reminders.dueMileageLabel")}</label>
      <input class="field__input" id="reminder-km" name="dueMileage" type="number"
        inputmode="numeric" min="0" step="1"
        value="${escHtml(fieldValue("dueMileage"))}" />
      ${vehicle?.currentOdometer != null ? `<p class="field__hint">${t("reminders.currentOdometerHint")} ${faNum(vehicle.currentOdometer)} ${t("common.kmUnit")}</p>` : ""}
      <p class="field__error" id="reminder-error-km" hidden></p>
    </div>`
    : "";

  // Offsets editor: one row per offset. Date-type reminders edit days,
  // mileage-type edit km; date_mileage shows both kinds together.
  const offsetRows = state.offsets
    .map((offset, index) => {
      const showDays = watchesDate;
      const showKm = watchesKm;
      const daysInput = showDays
        ? `
        <div class="affix-field reminder-offset__input">
          <input class="field__input affix-field__input" name="offset-days-${index}" type="number"
            inputmode="numeric" min="0" step="1" value="${offset.days != null ? escHtml(String(offset.days)) : ""}" />
          <span class="affix-field__suffix">${t("reminders.daysBefore")}</span>
        </div>`
        : "";
      const kmInput = showKm
        ? `
        <div class="affix-field reminder-offset__input">
          <input class="field__input affix-field__input" name="offset-km-${index}" type="number"
            inputmode="numeric" min="0" step="1" value="${offset.km != null ? escHtml(String(offset.km)) : ""}" />
          <span class="affix-field__suffix">${t("reminders.kmBefore")}</span>
        </div>`
        : "";
      return `
      <div class="reminder-offset" data-offset-index="${index}">
        ${daysInput}
        ${kmInput}
        <button type="button" class="icon-btn js-remove-offset" data-index="${index}"
          aria-label="${t("reminders.removeOffset")}" title="${t("reminders.removeOffset")}">
          <span data-lucide="x"></span>
        </button>
      </div>`;
    })
    .join("");

  const addOffsetButton =
    state.formType === "date"
      ? `<button type="button" class="btn btn--text js-add-offset" data-kind="days"><span data-lucide="plus"></span>${t("reminders.addDateOffset")}</button>`
      : state.formType === "mileage"
        ? `<button type="button" class="btn btn--text js-add-offset" data-kind="km"><span data-lucide="plus"></span>${t("reminders.addKmOffset")}</button>`
        : `<button type="button" class="btn btn--text js-add-offset" data-kind="days"><span data-lucide="plus"></span>${t("reminders.addDateOffset")}</button>
           <button type="button" class="btn btn--text js-add-offset" data-kind="km"><span data-lucide="plus"></span>${t("reminders.addKmOffset")}</button>`;

  const repeatKmField =
    state.formRepeat === "km"
      ? `
    <div class="field">
      <label class="field__label" for="reminder-repeat-km">${t("reminders.repeatEveryKmLabel")}</label>
      <input class="field__input" id="reminder-repeat-km" name="repeatEveryKm" type="number"
        inputmode="numeric" min="1" step="1" value="${escHtml(fieldValue("repeatEveryKm"))}" />
      <p class="field__error" id="reminder-error-repeat-km" hidden></p>
    </div>`
      : "";

  const enabled = fieldValue("enabled", "1") === "1";

  return `
    <div class="modal-overlay">
      <div class="modal modal--scroll" role="dialog" aria-modal="true" aria-label="${escHtml(title)}">
        <form id="reminder-form" class="form" novalidate>
          <div class="form__title">${escHtml(title)}</div>
          ${prefill?.serviceId ? `<input type="hidden" name="serviceId" value="${escHtml(prefill.serviceId)}" />` : ""}

          <div class="field">
            <label class="field__label" for="reminder-title">${t("reminders.titleLabel")}</label>
            <input class="field__input" id="reminder-title" name="title" type="text"
              value="${escHtml(fieldValue("title"))}"
              placeholder="${t("reminders.titlePlaceholder")}" />
            <p class="field__error" id="reminder-error-title" hidden></p>
          </div>

          <div class="field">
            <label class="field__label" for="reminder-description">${t("reminders.descriptionLabel")}</label>
            <textarea class="field__input" id="reminder-description" name="description" rows="2"
              placeholder="${t("reminders.descriptionPlaceholder")}">${escHtml(fieldValue("description"))}</textarea>
          </div>

          <div class="field">
            <label class="field__label" for="reminder-service">${t("reminders.serviceLabel")}</label>
            <select class="field__input" id="reminder-service" name="serviceId" ${prefill?.serviceId ? "disabled" : ""}>
              <option value="">${t("reminders.serviceNone")}</option>
              ${services
                .map(
                  (service) => `
                <option value="${escHtml(service.id)}" ${
                  fieldValue("serviceId", prefill?.serviceId ?? "") === service.id ? "selected" : ""
                }>${escHtml(service.name)}</option>`,
                )
                .join("")}
            </select>
          </div>

          <div class="field">
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
          </div>

          ${dateSection}
          ${kmSection}

          <div class="field">
            <span class="field__label">${t("reminders.notificationsLabel")}</span>
            <p class="field__hint">${t("reminders.notificationsHint")}</p>
            <div class="reminder-offsets">
              ${offsetRows || `<p class="empty-note">${t("reminders.errorNoOffsets")}</p>`}
            </div>
            <div class="reminder-offsets__add">${addOffsetButton}</div>
            <p class="field__error" id="reminder-error-offsets" hidden></p>
          </div>

          <div class="field">
            <span class="field__label" id="reminder-repeat-label">${t("reminders.repeatLabel")}</span>
            <div class="settings-theme segmented" role="radiogroup" aria-labelledby="reminder-repeat-label">
              ${repeatOptions
                .map(
                  (option) => `
                <button type="button" class="segmented__option js-reminder-repeat ${state.formRepeat === option.value ? "segmented__option--active" : ""}"
                  data-repeat="${option.value}" role="radio" aria-checked="${state.formRepeat === option.value}">
                  ${t(option.key)}
                </button>`,
                )
                .join("")}
            </div>
            ${repeatKmField}
          </div>

          <div class="field">
            <label class="toggle-row">
              <span class="toggle-row__label">${t("reminders.enabledLabel")}</span>
              <span class="toggle">
                <input type="checkbox" name="enabled" value="1" class="js-enabled-toggle"
                  role="switch" aria-label="${t("reminders.enabledLabel")}" ${enabled ? "checked" : ""} />
                <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
              </span>
            </label>
            <p class="field__hint">${t("reminders.enabledHint")}</p>
          </div>

          <div class="form__actions">
            <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
            <button type="submit" class="btn btn--filled">${t("common.save")}</button>
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
            <button type="button" class="btn btn--text js-close-overlay">${t("common.cancel")}</button>
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
  state.offsets = [];
  state.formType = "date";
  state.formRepeat = "none";
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
  // Default offsets: none — the user configures them; enabled by default.
  state.offsets = [{ days: 1 }];
  if (prefill != null) {
    if (prefill.title !== "") state.formValues.title = prefill.title;
    if (prefill.dueDate != null) state.formValues.dueDate = prefill.dueDate;
    if (prefill.dueMileage != null) state.formValues.dueMileage = String(prefill.dueMileage);
    if (prefill.serviceId != null) state.formValues.serviceId = prefill.serviceId;
  }
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

  /* Add reminder — uses the currently selected vehicle (never asks again). */
  container.querySelectorAll<HTMLButtonElement>(".js-add-reminder").forEach((button) => {
    button.addEventListener("click", () => {
      const dataset = store.get();
      const vehicleId = resolveSelectedVehicleId(dataset);
      openAddForm(
        vehicleId == null
          ? null
          : { vehicleId, serviceId: null, title: "", dueDate: null, dueMileage: null, currentOdometer: null },
      );
      redraw(container);
    });
  });

  /* Card menu (edit/delete). */
  container.querySelectorAll<HTMLButtonElement>(".js-reminder-menu-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id ?? null;
      state.menuReminderId = state.menuReminderId === id ? null : id;
      redraw(container);
    });
  });
  container.querySelector<HTMLElement>(".js-reminder-menu-backdrop")?.addEventListener("click", () => {
    state.menuReminderId = null;
    redraw(container);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-reminder-menu-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const dataset = store.get();
      const reminder = dataset.reminders.find((r) => r.id === button.dataset.id);
      if (!reminder) return;
      closeForm();
      state.menuReminderId = null;
      state.form = { mode: "edit", reminderId: reminder.id };
      state.formType = reminder.type;
      state.formRepeat = reminder.repeat;
      state.offsets = reminder.notificationOffsets.map((offset) => ({ ...offset }));
      state.formValues = {
        title: reminder.title,
        description: reminder.description,
        serviceId: reminder.serviceId ?? "",
        dueDate: reminder.dueDate ?? "",
        dueMileage: reminder.dueMileage != null ? String(reminder.dueMileage) : "",
        repeatEveryKm: reminder.repeatEveryKm != null ? String(reminder.repeatEveryKm) : "",
        enabled: reminder.enabled ? "1" : "0",
      };
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-reminder-menu-delete").forEach((button) => {
    button.addEventListener("click", () => {
      state.menuReminderId = null;
      state.deleteConfirmId = button.dataset.id ?? null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-confirm-reminder-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id ?? "";
      state.deleteConfirmId = null;
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

  /* Type + repeat segmented controls. */
  container.querySelectorAll<HTMLButtonElement>(".js-reminder-type").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type as Reminder["type"] | undefined;
      if (!type || type === state.formType) return;
      state.formType = type;
      // Drop offsets that no longer apply to the chosen type.
      state.offsets = state.offsets.filter((offset) =>
        type === "date" ? offset.days != null : type === "mileage" ? offset.km != null : true,
      );
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-reminder-repeat").forEach((button) => {
    button.addEventListener("click", () => {
      const repeat = button.dataset.repeat as RepeatMode | undefined;
      if (repeat) state.formRepeat = repeat;
      redraw(container);
    });
  });

  /* Offsets editor. */
  container.querySelectorAll<HTMLButtonElement>(".js-add-offset").forEach((button) => {
    button.addEventListener("click", () => {
      state.offsets.push(button.dataset.kind === "km" ? { km: 100 } : { days: 7 });
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-remove-offset").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (Number.isInteger(index)) state.offsets.splice(index, 1);
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

/** Gathers offsets from the live form inputs into NotificationOffset rows. */
function collectOffsets(container: HTMLElement): NotificationOffset[] {
  const watchesDate = state.formType === "date" || state.formType === "date_mileage";
  const watchesKm = state.formType === "mileage" || state.formType === "date_mileage";
  const offsets: NotificationOffset[] = [];
  container.querySelectorAll<HTMLElement>(".reminder-offset").forEach((row) => {
    const offset: NotificationOffset = {};
    if (watchesDate) {
      const input = row.querySelector<HTMLInputElement>("input[name^='offset-days']");
      const value = input?.value.trim() ?? "";
      if (value !== "") offset.days = Number(toLatinDigits(value));
    }
    if (watchesKm) {
      const input = row.querySelector<HTMLInputElement>("input[name^='offset-km']");
      const value = input?.value.trim() ?? "";
      if (value !== "") offset.km = Number(toLatinDigits(value));
    }
    if (offset.days != null || offset.km != null) offsets.push(offset);
  });
  return offsets;
}

/** Builds a Reminder from the form, validates, then saves (Phase 5+7). */
function submitReminderForm(container: HTMLElement, form: HTMLFormElement): void {
  const dataset = store.get();
  const formState = state.form;
  if (!formState) return;
  const vehicleId = resolveSelectedVehicleId(dataset);
  if (vehicleId == null) return;

  const data = new FormData(form);
  const title = String(data.get("title") ?? "").trim();
  const description = String(data.get("description") ?? "").trim();
  const serviceRaw = String(data.get("serviceId") ?? "").trim();
  const serviceId = serviceRaw !== "" ? serviceRaw : (formState.mode === "add" ? formState.prefill?.serviceId ?? null : null);

  const dateRaw = String(data.get("dueDate") ?? "").trim();
  const dueDate = watchesDate() && dateRaw !== "" ? dateRaw : null;
  const kmRaw = String(data.get("dueMileage") ?? "").trim();
  const dueMileage = watchesKm() && kmRaw !== "" ? Number(toLatinDigits(kmRaw)) : null;

  const repeatEveryKmRaw = String(data.get("repeatEveryKm") ?? "").trim();
  const repeatEveryKm = state.formRepeat === "km" && repeatEveryKmRaw !== "" ? Number(toLatinDigits(repeatEveryKmRaw)) : null;
  const enabled = data.get("enabled") === "1";

  const draft = {
    vehicleId,
    title,
    description,
    serviceId,
    type: state.formType,
    dueDate,
    dueMileage,
    notificationOffsets: collectOffsets(container),
    repeat: state.formRepeat,
    repeatEveryKm,
    enabled,
  };

  const errors = validateReminderDraft(draft);
  if (errors.length > 0) {
    showReminderErrors(container, errors.map((error) => [error, t(ERROR_KEYS[error])]));
    return;
  }

  const now = new Date().toISOString();
  const editing = formState.mode === "edit";
  const reminder: Reminder = editing
    ? {
        ...((dataset.reminders.find((r) => r.id === formState.reminderId) as Reminder) ?? { id: createId() }),
        ...draft,
        updatedAt: now,
      }
    : {
        id: createId(),
        ...draft,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        createdAt: now,
        updatedAt: now,
      };

  closeForm();
  if (!editing && needsPermissionPrompt(dataset, enabled)) {
    // First notification-enabled reminder: ask BEFORE saving (Phase 7).
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
    repeatKmRequired: "reminder-error-repeat-km",
    repeatKmInvalid: "reminder-error-repeat-km",
    offsetInvalid: "reminder-error-offsets",
    noOffsets: "reminder-error-offsets",
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

/** Re-renders without notifying the store (view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = remindersViewHtml();
  bind(container);
  applyIcons();
  bindFloatingFields(container);
  bindDateFields(container);
  alignFabBar();
}
