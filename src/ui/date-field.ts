/**
 * Calendar-aware date field (§4 of the calendar requirements).
 *
 * Replaces the native `<input type="date">` with a popover month grid that
 * renders in the SELECTED calendar system (Solar Hijri by default): Persian
 * month names (فروردین … اسفند), Jalali year navigation, Saturday-first
 * weeks, and correct leap/month lengths. Picking a day stores the Gregorian
 * ISO ("yyyy-mm-dd") in a hidden input — the app's internal representation
 * is never a Jalali string (§3).
 *
 * The widget is self-contained: each `[data-date-field]` root owns its
 * hidden input, trigger button, and popover, so views just render
 * `dateFieldHtml(...)` and call `bindDateFields(container)` alongside their
 * other bindings. Selecting a day dispatches a bubbling `change` event on
 * the hidden input so the item form's re-render-safe value capture
 * (decision 31) keeps working.
 */

import {
  currentCalendar,
  faDigits,
  formatDate,
  gregorianIsoToJalaliIso,
  monthGrid,
  parseIso,
  todayIso,
  WEEKDAYS_SHORT,
} from "../domain/calendar";
import type { CalendarPreference } from "../domain/types";
import { t } from "../i18n";
import { escHtml } from "./escape";

export interface DateFieldOptions {
  /** id of the trigger button (the form's <label for> points here). */
  fieldId: string;
  /** name of the hidden input (read by FormData on submit). */
  name: string;
  /** Current value as Gregorian ISO "yyyy-mm-dd"; "" = none. */
  value: string;
  /** Accessible name of the field (from the form label). */
  label: string;
}

/** Field markup: hidden ISO input + trigger button + (empty) popover. */
export function dateFieldHtml(opts: DateFieldOptions): string {
  const calendar = currentCalendar();
  const hasValue = opts.value !== "";
  return `
    <div class="date-field" data-date-field>
      <input type="hidden" id="${escHtml(opts.fieldId)}-input" name="${escHtml(opts.name)}"
        value="${escHtml(opts.value)}" data-df-input />
      <button type="button" id="${escHtml(opts.fieldId)}" class="field__input date-field__button"
        data-df-button aria-haspopup="dialog" aria-expanded="false" aria-label="${escHtml(opts.label)}">
        <span class="date-field__value ${hasValue ? "" : "date-field__value--empty"}" data-df-value>
          ${hasValue ? escHtml(formatDate(opts.value, calendar)) : escHtml(t("dateField.empty"))}
        </span>
        <span data-lucide="calendar" class="date-field__icon" aria-hidden="true"></span>
      </button>
      <div class="date-field__popover" data-df-popover hidden role="dialog" aria-label="${escHtml(opts.label)}"></div>
    </div>
  `;
}

/** Wires every `[data-date-field]` inside `container`. Call on each render. */
export function bindDateFields(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>("[data-date-field]").forEach((root) => {
    const button = root.querySelector<HTMLButtonElement>("[data-df-button]");
    const popover = root.querySelector<HTMLElement>("[data-df-popover]");
    const input = root.querySelector<HTMLInputElement>("[data-df-input]");
    if (!button || !popover || !input) return;

    button.addEventListener("click", () => {
      if (popover.hidden) {
        openPopover(root, popover, input);
      } else {
        closePopover(root, popover);
      }
    });
  });
  registerGlobalClose();
}

/* --- Popover internals --- */

/** The (year, month) the picker should open at: the current value's month,
 * or today's month when no value is set. In the SELECTED calendar. */
function viewYearMonth(calendar: CalendarPreference, isoValue: string): { year: number; month: number } {
  const today = todayIso();
  if (isoValue !== "") {
    if (calendar === "jalali") {
      const jalaliIso = gregorianIsoToJalaliIso(isoValue);
      if (jalaliIso) {
        const [jy, jm] = jalaliIso.split("-").map(Number);
        return { year: jy, month: jm };
      }
    } else {
      const parts = parseIso(isoValue);
      if (parts) return { year: parts.year, month: parts.month };
    }
  }
  return calendar === "jalali"
    ? (() => {
        const jalaliIso = gregorianIsoToJalaliIso(today) ?? "";
        const [jy, jm] = jalaliIso.split("-").map(Number);
        return { year: jy, month: jm };
      })()
    : (() => {
        const parts = parseIso(today);
        return { year: parts!.year, month: parts!.month };
      })();
}

function openPopover(
  root: HTMLElement,
  popover: HTMLElement,
  input: HTMLInputElement,
): void {
  const calendar = currentCalendar();
  const view = viewYearMonth(calendar, input.value);
  renderPopover(root, popover, calendar, view.year, view.month, input.value);
  popover.hidden = false;
  root.querySelector<HTMLButtonElement>("[data-df-button]")?.setAttribute("aria-expanded", "true");
}

function closePopover(root: HTMLElement, popover: HTMLElement): void {
  popover.hidden = true;
  root.querySelector<HTMLButtonElement>("[data-df-button]")?.setAttribute("aria-expanded", "false");
}

function renderPopover(
  root: HTMLElement,
  popover: HTMLElement,
  calendar: CalendarPreference,
  year: number,
  month: number,
  selectedIso: string,
): void {
  const grid = monthGrid(calendar, year, month, todayIso());

  const cells: string[] = [];
  for (let i = 0; i < grid.lead; i += 1) {
    cells.push('<span class="date-field__day date-field__day--empty"></span>');
  }
  for (const cell of grid.cells) {
    const classes = ["date-field__day"];
    if (cell.iso === selectedIso) classes.push("date-field__day--selected");
    if (cell.isToday) classes.push("date-field__day--today");
    cells.push(
      `<button type="button" class="${classes.join(" ")}" data-df-day="${cell.iso}"` +
        ` aria-label="${escHtml(formatDate(cell.iso, calendar))}" aria-pressed="${cell.iso === selectedIso}">` +
        `${faDigits(cell.day)}</button>`,
    );
  }

  popover.innerHTML = `
    <div class="date-field__nav">
      <button type="button" class="date-field__nav-btn" data-df-prev aria-label="${t("dateField.prevMonth")}">‹</button>
      <div class="date-field__heading">${escHtml(grid.monthName)} ${faDigits(grid.year)}</div>
      <button type="button" class="date-field__nav-btn" data-df-next aria-label="${t("dateField.nextMonth")}">›</button>
    </div>
    <div class="date-field__weekdays" aria-hidden="true">
      ${WEEKDAYS_SHORT.map((weekday) => `<span>${weekday}</span>`).join("")}
    </div>
    <div class="date-field__grid" role="grid" aria-label="${escHtml(`${grid.monthName} ${faDigits(grid.year)}`)}">
      ${cells.join("")}
    </div>
    <div class="date-field__foot">
      <button type="button" class="btn btn--text" data-df-today>${t("dateField.today")}</button>
    </div>
  `;

  // Store the view so month navigation can shift it.
  popover.dataset.dfYear = String(year);
  popover.dataset.dfMonth = String(month);

  popover.querySelector<HTMLButtonElement>("[data-df-prev]")?.addEventListener("click", () => {
    shiftMonth(root, popover, -1, selectedIso);
  });
  popover.querySelector<HTMLButtonElement>("[data-df-next]")?.addEventListener("click", () => {
    shiftMonth(root, popover, 1, selectedIso);
  });
  popover.querySelectorAll<HTMLButtonElement>("[data-df-day]").forEach((dayButton) => {
    dayButton.addEventListener("click", () => {
      selectDay(root, popover, dayButton.dataset.dfDay ?? "");
    });
  });
  popover.querySelector<HTMLButtonElement>("[data-df-today]")?.addEventListener("click", () => {
    selectDay(root, popover, todayIso());
  });
}

function shiftMonth(root: HTMLElement, popover: HTMLElement, delta: number, selectedIso: string): void {
  const year = Number(popover.dataset.dfYear);
  const month = Number(popover.dataset.dfMonth);
  const calendar = currentCalendar();
  const total = year * 12 + (month - 1) + delta;
  renderPopover(root, popover, calendar, Math.floor(total / 12), (total % 12) + 1, selectedIso);
}

/** Stores the picked date (Gregorian ISO), updates the label, notifies the
 * form, and closes the popover. */
function selectDay(root: HTMLElement, popover: HTMLElement, iso: string): void {
  if (iso === "") return;
  const input = root.querySelector<HTMLInputElement>("[data-df-input]");
  const valueEl = root.querySelector<HTMLElement>("[data-df-value]");
  if (!input || !valueEl) return;

  input.value = iso;
  valueEl.textContent = formatDate(iso);
  valueEl.classList.remove("date-field__value--empty");
  // Bubbling change keeps the item form's re-render-safe capture working.
  input.dispatchEvent(new Event("change", { bubbles: true }));
  closePopover(root, popover);
}

/* --- Global close (outside click / Escape) --- */

let globalCloseRegistered = false;

function registerGlobalClose(): void {
  if (globalCloseRegistered) return;
  globalCloseRegistered = true;
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[data-date-field]")) return;
    closeAllPopovers();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllPopovers();
  });
}

function closeAllPopovers(): void {
  document.querySelectorAll<HTMLElement>("[data-date-field]").forEach((root) => {
    const popover = root.querySelector<HTMLElement>("[data-df-popover]");
    if (popover && !popover.hidden) closePopover(root, popover);
  });
}