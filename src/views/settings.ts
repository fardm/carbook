import type { Dataset, ThemePreference } from "../domain/types";
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
import { applyIcons } from "../ui/icons";

/**
 * Settings view — JSON backup & restore (§41–§43).
 *
 * Export downloads the whole dataset as a pretty JSON file and stamps
 * `exportedAt` (§41). Import is defensive end to end: parse → FULL strict
 * structural validation (decision 13 — loading is defensive, import is
 * fail-closed) → preview with counts → explicit confirm → atomic
 * `store.replace` (§40 step 5–6, §42). The §43 backup warning is always
 * visible here and repeated right before an overwrite.
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
  };
  draw();
  return store.subscribe(draw);
}

function settingsViewHtml(): string {
  const dataset = store.get();
  return `
    <div class="view-stack">
      <h1 class="view-title">${t("view.settings.title")}</h1>
      ${appearanceCardHtml(dataset)}
      ${backupCardHtml(dataset)}
      ${restoreCardHtml()}
    </div>
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

/* --- Backup (export) card --- */

function backupCardHtml(dataset: Dataset): string {
  const lastExport = dataset.exportedAt
    ? `${t("settings.lastExport")}: <b>${escHtml(formatDateTime(dataset.exportedAt))}</b>`
    : t("settings.neverExported");
  return `
    <section class="card">
      <h2 class="card__title">${t("settings.backupTitle")}</h2>
      <p class="card__text">${t("settings.backupIntro")}</p>
      <div class="box box--warn" role="note">${t("settings.backupWarning")}</div>
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
      <input type="file" id="import-file" class="visually-hidden"
        accept=".json,application/json" />
      <label for="import-file" class="btn btn--filled settings-file-label">
        <span data-lucide="upload"></span>
        ${t("settings.chooseFile")}
      </label>
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
    `<div class="info-list__row"><dt>${t("settings.rowVehicle")}</dt><dd>${dataset.vehicle ? escHtml(dataset.vehicle.name) : t("dashboard.noVehicle")}</dd></div>`,
    `<div class="info-list__row"><dt>${t("settings.rowOdometer")}</dt><dd>${faNum(dataset.odometerHistory.length)}</dd></div>`,
    `<div class="info-list__row"><dt>${t("settings.rowItems")}</dt><dd>${faNum(dataset.maintenanceItems.length)}</dd></div>`,
    `<div class="info-list__row"><dt>${t("settings.rowServices")}</dt><dd>${faNum(dataset.serviceHistory.length)}</dd></div>`,
    `<div class="info-list__row"><dt>${t("settings.rowInspections")}</dt><dd>${faNum(dataset.inspectionHistory.length)}</dd></div>`,
  ].join("");
  return `
    <div class="settings-preview">
      <h3 class="settings-preview__title">${t("settings.previewTitle")}
        <code dir="ltr">${escHtml(pending.fileName)}</code></h3>
      <dl class="info-list">${rows}</dl>
      <div class="box box--danger" role="alert">${t("settings.overwriteWarning")}</div>
      <div class="settings-preview__actions">
        <button type="button" class="btn btn--text js-cancel-import">${t("common.cancel")}</button>
        <button type="button" class="btn btn--danger js-confirm-import">
          ${t("settings.confirmReplace")}
        </button>
      </div>
    </div>
  `;
}

/* --- Events --- */

function bind(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>(".js-theme-option").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = (button.dataset.themeValue as ThemePreference) ?? "system";
      store.update((draft) => {
        draft.settings.theme = theme;
      });
    });
  });
  container.querySelector<HTMLButtonElement>(".js-export")?.addEventListener("click", onExport);
  container.querySelector<HTMLInputElement>("#import-file")?.addEventListener("change", (event) => {
    onFileChosen(container, event.currentTarget as HTMLInputElement);
  });
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
  if (!file) return;
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
