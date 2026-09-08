import type { CalendarPreference, Currency, Dataset, ThemePreference } from "../domain/types";
import {
  notificationPermission,
  requestNotificationPermission,
  runReminderCheck,
} from "../domain/reminder-checker";
import { t, type MessageKey } from "../i18n";
import {
  backupFilename,
  buildExport,
  serializeExport,
  validateImportText,
  type ImportIssue,
  type ImportIssueKind,
} from "../persistence/import-export";
import { store } from "../state/store";
import { escHtml } from "../ui/escape";
import { faNum, formatDateTime } from "../ui/format";
import { bindFloatingFields } from "../ui/floating-field";
import { applyIcons } from "../ui/icons";

/**
 * Settings view — JSON backup & restore (§41–§43).
 *
 * Export downloads the whole dataset as a pretty JSON file and stamps
 * `exportedAt` (§41). Import is defensive end to end: parse → FULL strict
 * structural validation (decision 13 — loading is defensive, import is
 * fail-closed) → preview with counts → explicit confirm → atomic
 * `store.replace` (§40 step 5–6, §42). Overwrite confirmation is shown in
 * the import preview before replacing data.
 */

interface SettingsViewState {
  /** Validated file awaiting the user's overwrite confirmation. */
  pending: { fileName: string; dataset: Dataset } | null;
  /** Validation issues of the last rejected file; null when no error shown. */
  issues: ImportIssue[] | null;
  /** True right after a successful import (dismissible). */
  imported: boolean;
}

const state: SettingsViewState = { pending: null, issues: null, imported: false };

const THEME_KEYS: Record<ThemePreference, MessageKey> = {
  system: "settings.themeSystem",
  light: "settings.themeLight",
  dark: "settings.themeDark",
};

const THEME_OPTIONS: ThemePreference[] = ["system", "light", "dark"];

const CALENDAR_KEYS: Record<CalendarPreference, MessageKey> = {
  jalali: "settings.calendarJalali",
  gregorian: "settings.calendarGregorian",
};

const CALENDAR_OPTIONS: CalendarPreference[] = ["jalali", "gregorian"];

const CURRENCY_KEYS: Record<Currency, MessageKey> = {
  IRR: "settings.currencyIrr",
  USD: "settings.currencyUsd",
  EUR: "settings.currencyEur",
};

const CURRENCY_OPTIONS: Currency[] = ["IRR", "USD", "EUR"];

const ISSUE_KEYS: Record<ImportIssueKind, MessageKey> = {
  notJson: "settings.issue.notJson",
  notObject: "settings.issue.notObject",
  missingField: "settings.issue.missingField",
  wrongType: "settings.issue.wrongType",
  invalidValue: "settings.issue.invalidValue",
  unsupportedVersion: "settings.issue.unsupportedVersion",
  duplicateId: "settings.issue.duplicateId",
  unknownReference: "settings.issue.unknownReference",
};

/** Show at most this many issues in the error list. */
const MAX_SHOWN_ISSUES = 15;

export function renderSettings(container: HTMLElement): () => void {
  const draw = (): void => {
    container.innerHTML = settingsViewHtml();
    bind(container);
    applyIcons();
    bindFloatingFields(container);
  };
  draw();
  return store.subscribe(draw);
}

function settingsViewHtml(): string {
  const dataset = store.get();
  return `
    <div class="view-stack">
      <h1 class="view-title">${t("view.settings.title")}</h1>
      ${calendarCardHtml(dataset)}
      ${currencyCardHtml(dataset)}
      ${appearanceCardHtml(dataset)}
      ${notificationsCardHtml()}
      ${backupCardHtml(dataset)}
      ${restoreCardHtml()}
    </div>
  `;
}

/* --- Calendar (date system) card --- */

function calendarCardHtml(dataset: Dataset): string {
  const current = dataset.settings.calendar;
  const options = CALENDAR_OPTIONS.map(
    (value) => `
      <button type="button" class="segmented__option js-calendar-option
        ${current === value ? "segmented__option--active" : ""}"
        data-calendar-value="${value}" role="radio" aria-checked="${current === value}">
        ${t(CALENDAR_KEYS[value])}
      </button>
    `,
  ).join("");
  return `
    <section class="card">
      <h2 class="card__title">${t("settings.calendarTitle")}</h2>
      <p class="card__text">${t("settings.calendarHint")}</p>
      <div class="settings-theme segmented" role="radiogroup" aria-label="${t("settings.calendarTitle")}">
        ${options}
      </div>
    </section>
  `;
}

/* --- Currency (service cost unit) card --- */

function currencyCardHtml(dataset: Dataset): string {
  const current = dataset.settings.currency;
  const options = CURRENCY_OPTIONS.map(
    (value) => `
      <button type="button" class="segmented__option js-currency-option
        ${current === value ? "segmented__option--active" : ""}"
        data-currency-value="${value}" role="radio" aria-checked="${current === value}">
        ${t(CURRENCY_KEYS[value])}
      </button>
    `,
  ).join("");
  return `
    <section class="card">
      <h2 class="card__title">${t("settings.currencyTitle")}</h2>
      <p class="card__text">${t("settings.currencyHint")}</p>
      <div class="settings-theme segmented" role="radiogroup" aria-label="${t("settings.currencyTitle")}">
        ${options}
      </div>
    </section>
  `;
}

/* --- Appearance (colour theme) card --- */

function appearanceCardHtml(dataset: Dataset): string {
  const current = dataset.settings.theme;
  const options = THEME_OPTIONS.map(
    (value) => `
      <button type="button" class="segmented__option js-theme-option
        ${current === value ? "segmented__option--active" : ""}"
        data-theme-value="${value}" role="radio" aria-checked="${current === value}">
        ${t(THEME_KEYS[value])}
      </button>
    `,
  ).join("");
  return `
    <section class="card">
      <h2 class="card__title">${t("settings.appearanceTitle")}</h2>
      <p class="card__text">${t("settings.appearanceHint")}</p>
      <div class="settings-theme segmented" role="radiogroup" aria-label="${t("settings.appearanceTitle")}">
        ${options}
      </div>
    </section>
  `;
}

/* --- Notifications (browser permission) card --- */

function notificationsCardHtml(): string {
  // Both the pill and the action derive from the LIVE browser state every
  // render — never from a cached flag — so the card can never claim a
  // permission state the browser disagrees with.
  const permission = notificationPermission();
  const enabled = permission === "granted";
  const statusText = enabled
    ? t("notifications.stateEnabled")
    : t("notifications.stateDefault");
  // Undecided only: request the browser permission from this explicit
  // gesture. When granted there is no button — browsers have no
  // programmatic revoke, so the guide text below explains the manual way.
  const actionHtml =
    permission === "default"
      ? `
        <button type="button" class="btn btn--filled js-enable-notifications">
          <span data-lucide="bell"></span>
          ${t("notifications.enableButton")}
        </button>`
      : "";
  return `
    <section class="card">
      <h2 class="card__title">${t("notifications.settingsTitle")}</h2>
      <p class="card__text">${t("notifications.settingsHint")}</p>
      <div class="settings-status">
        <span class="settings-status__indicator${enabled ? " settings-status__indicator--on" : ""}" role="status">
          <span class="settings-status__dot" aria-hidden="true"></span>
          <span>${statusText}</span>
        </span>
        ${actionHtml}
      </div>
      ${notificationGuideHtml()}
    </section>
  `;
}

/** Guidance under the status row: why enabling is blocked (denied /
 * unsupported), or — while granted — how to turn notifications off
 * manually (browsers never let a page revoke permission itself). */
function notificationGuideHtml(): string {
  const permission = notificationPermission();
  let text: string | null = null;
  if (permission === "denied") {
    text = t("notifications.stateDenied");
  } else if (permission === "unsupported") {
    text = t("notifications.stateUnsupported");
  } else if (permission === "granted") {
    text = t("notifications.revokeHint");
  }
  if (text == null) return "";
  return `
    <div class="settings-status__guide">
      <p class="settings-note">${text}</p>
    </div>
  `;
}

/* --- Backup (export) card --- */

function backupCardHtml(dataset: Dataset): string {
  const lastExport = dataset.exportedAt
    ? `${t("settings.lastExport")}: <b>${escHtml(formatDateTime(dataset.exportedAt))}</b>`
    : t("settings.neverExported");
  return `
    <section class="card">
      <h2 class="card__title">${t("settings.backupTitle")}</h2>
      <p class="card__text">${t("settings.backupIntro")}</p>
      <div class="settings-action-row">
        <button type="button" class="btn btn--filled js-export">
          <span data-lucide="download"></span>
          ${t("settings.exportButton")}
        </button>
        <p class="settings-note js-last-export">${lastExport}</p>
      </div>
    </section>
  `;
}

/* --- Restore (import) card --- */

function restoreCardHtml(): string {
  return `
    <section class="card">
      <h2 class="card__title">${t("settings.restoreTitle")}</h2>
      <p class="card__text">${t("settings.restoreIntro")}</p>
      <div class="settings-dropzone js-import-dropzone">
        <input type="file" id="import-file" class="visually-hidden"
          accept=".json,application/json" />
        <label for="import-file" class="settings-dropzone__label">
          <span class="settings-dropzone__icon" data-lucide="upload" aria-hidden="true"></span>
          <span class="settings-dropzone__title">${t("settings.chooseFile")}</span>
          <span class="settings-dropzone__hint">${t("settings.dropzoneHint")}</span>
        </label>
      </div>
      ${state.imported ? successBoxHtml() : ""}
      ${state.issues ? errorBoxHtml(state.issues) : ""}
      ${state.pending ? previewHtml(state.pending) : ""}
    </section>
  `;
}

function successBoxHtml(): string {
  return `
    <div class="box box--success settings-success" role="status">
      <span data-lucide="circle-check"></span>
      <span>${t("settings.restoreSuccess")}</span>
      <button type="button" class="btn btn--text js-dismiss-success">${t("settings.dismiss")}</button>
    </div>
  `;
}

function errorBoxHtml(issues: ImportIssue[]): string {
  const shown = issues.slice(0, MAX_SHOWN_ISSUES);
  const rest = issues.length - shown.length;
  const items = shown
    .map((issue) => {
      const label = t(ISSUE_KEYS[issue.kind]);
      const location = issue.path
        ? `«<span dir="ltr">${escHtml(issue.path)}</span>» — `
        : "";
      return `<li>${location}${label}</li>`;
    })
    .join("");
  return `
    <div class="box box--error settings-errors" role="alert">
      <div class="settings-errors__title">${t("settings.invalidTitle")}</div>
      <p>${t("settings.invalidLead")}</p>
      <ul class="settings-errors__list">
        ${items}
        ${rest > 0 ? `<li>${faNum(rest)} ${t("settings.issueMore")}</li>` : ""}
      </ul>
    </div>
  `;
}

function previewHtml(pending: { fileName: string; dataset: Dataset }): string {
  const { dataset } = pending;
  const rows = [
    dataset.exportedAt
      ? `<div class="info-list__row"><dt>${t("settings.exportedOn")}</dt><dd>${escHtml(formatDateTime(dataset.exportedAt))}</dd></div>`
      : "",
    `<div class="info-list__row"><dt>${t("settings.rowVehicles")}</dt><dd>${faNum(dataset.vehicles.length)}</dd></div>`,
    `<div class="info-list__row"><dt>${t("settings.rowOdometer")}</dt><dd>${faNum(dataset.vehicles.filter((v) => v.currentOdometer != null).length)}</dd></div>`,
    `<div class="info-list__row"><dt>${t("settings.rowItems")}</dt><dd>${faNum(dataset.maintenanceItems.length)}</dd></div>`,
    `<div class="info-list__row"><dt>${t("settings.rowServices")}</dt><dd>${faNum(dataset.serviceHistory.length)}</dd></div>`,
  ].join("");
  return `
    <div class="settings-preview">
      <h3 class="settings-preview__title">${t("settings.previewTitle")}
        <code dir="ltr">${escHtml(pending.fileName)}</code></h3>
      <dl class="info-list">${rows}</dl>
      <div class="box box--danger" role="alert">${t("settings.overwriteWarning")}</div>
      <div class="settings-preview__actions">
        <button type="button" class="btn btn--text js-cancel-import">${t("common.cancel")}</button>
        <button type="button" class="btn btn--filled js-confirm-import">
          ${t("settings.confirmReplace")}
        </button>
      </div>
    </div>
  `;
}

/* --- Events --- */

function bind(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>(".js-calendar-option").forEach((button) => {
    button.addEventListener("click", () => {
      const calendar = (button.dataset.calendarValue as CalendarPreference) ?? "jalali";
      store.update((draft) => {
        draft.settings.calendar = calendar;
      });
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-theme-option").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = (button.dataset.themeValue as ThemePreference) ?? "system";
      store.update((draft) => {
        draft.settings.theme = theme;
      });
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-currency-option").forEach((button) => {
    button.addEventListener("click", () => {
      const currency = (button.dataset.currencyValue as Currency) ?? "IRR";
      store.update((draft) => {
        draft.settings.currency = currency;
      });
    });
  });
  /* Enable notifications — only requests the browser prompt from this
   * explicit gesture, and only while permission is still "default". Must
   * not await anything before requestPermission (Android user activation). */
  container.querySelector<HTMLButtonElement>(".js-enable-notifications")?.addEventListener("click", () => {
    const permissionPromise = requestNotificationPermission();
    void permissionPromise.then((permission) => {
      if (permission === "granted") {
        try {
          runReminderCheck(store.get());
        } catch {
          /* a failed check must not break settings */
        }
      }
      redraw(container);
    });
  });
  container.querySelector<HTMLButtonElement>(".js-export")?.addEventListener("click", onExport);
  const fileInput = container.querySelector<HTMLInputElement>("#import-file");
  fileInput?.addEventListener("change", (event) => {
    onFileChosen(container, event.currentTarget as HTMLInputElement);
  });
  bindImportDropzone(container, fileInput);
  container.querySelector<HTMLButtonElement>(".js-confirm-import")?.addEventListener("click", () => {
    confirmImport();
  });
  container.querySelector<HTMLButtonElement>(".js-cancel-import")?.addEventListener("click", () => {
    state.pending = null;
    redraw(container);
  });
  container.querySelector<HTMLButtonElement>(".js-dismiss-success")?.addEventListener("click", () => {
    state.imported = false;
    redraw(container);
  });
}

/** Stamps exportedAt, persists it, then downloads the JSON file (§41). */
function onExport(): void {
  const exportedAt = new Date().toISOString();
  store.update((draft) => {
    draft.exportedAt = exportedAt;
  });
  const dataset = store.get();
  const content = serializeExport(buildExport(dataset, dataset.exportedAt ?? exportedAt));
  downloadBlob(content, backupFilename(exportedAt.slice(0, 10)), "application/json");
}

function onFileChosen(container: HTMLElement, input: HTMLInputElement): void {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  processImportFile(container, file);
}

/** Wires drag-and-drop onto the import dropzone; click still uses the
 * native file input via the label. */
function bindImportDropzone(container: HTMLElement, fileInput: HTMLInputElement | null): void {
  const dropzone = container.querySelector<HTMLElement>(".js-import-dropzone");
  if (!dropzone) return;

  const setActive = (active: boolean): void => {
    dropzone.classList.toggle("settings-dropzone--active", active);
  };

  dropzone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    setActive(true);
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setActive(true);
  });
  dropzone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    // Ignore leave events that stay inside the dropzone (child → parent).
    if (event.relatedTarget instanceof Node && dropzone.contains(event.relatedTarget)) return;
    setActive(false);
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    setActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (fileInput) fileInput.value = "";
    processImportFile(container, file);
  });
}

function processImportFile(container: HTMLElement, file: File): void {
  state.imported = false;
  state.issues = null;
  state.pending = null;
  void file
    .text()
    .then((text) => {
      const result = validateImportText(text);
      if (result.ok) {
        state.pending = { fileName: file.name, dataset: result.dataset };
      } else {
        state.issues = result.issues;
      }
      redraw(container);
    })
    .catch(() => {
      state.issues = [{ path: "", kind: "notJson" }];
      redraw(container);
    });
}

/** Replaces the whole dataset only after explicit confirmation (§42). */
function confirmImport(): void {
  const pending = state.pending;
  if (!pending) return;
  // Decision 27: clear local state BEFORE the store write so the
  // notify-driven re-render shows the success state, not the stale preview.
  state.pending = null;
  state.imported = true;
  store.replace(pending.dataset);
}

/** Re-renders without notifying the store (pure view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = settingsViewHtml();
  bind(container);
  applyIcons();
  bindFloatingFields(container);
}

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
