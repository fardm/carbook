/**
 * Calendar-aware date field (§4 of the calendar requirements).
 *
 * A hybrid input: the visible control is a TEXT input where the user can
 * type the date manually in the selected calendar ("۱۴۰۵/۰۶/۱۴" or
 * "۲۰۲۶/۰۹/۰۵"), and a calendar icon on the LEFT opens the popover month
 * grid (Jalali by default). Both paths write the SAME hidden ISO input
 * ("yyyy-mm-dd") — the app's internal representation is never a Jalali
 * string (§3) — and both feed the form's existing date validation
 * unchanged.
 *
 * The widget is self-contained: each `[data-date-field]` root owns its
 * hidden input, text input, calendar trigger, and popover, so views just
 * render `dateFieldHtml(...)` and call `bindDateFields(container)`.
 * Selecting a day (or successfully parsing typed text) dispatches a
 * bubbling `change` event on the hidden input so the item form's
 * re-render-safe value capture (decision 31) keeps working.
 */

import {
  currentCalendar,
  faDigits,
  formatDate,
  gregorianIsoToJalaliIso,
  jalaliIsoToGregorianIso,
  monthGrid,
  parseIso,
  toCalendarIso,
  todayIso,
  WEEKDAYS_SHORT,
} from "../domain/calendar";
import type { CalendarPreference } from "../domain/types";
import { t } from "../i18n";
import { escHtml } from "./escape";

export interface DateFieldOptions {
  /** id of the text input (the form's <label for> points here). */
  fieldId: string;
  /** name of the hidden input (read by FormData on submit). */
  name: string;
  /** Current value as Gregorian ISO "yyyy-mm-dd"; "" = none. */
  value: string;
  /** Accessible name of the field (from the form label). */
  label: string;
}

/** Field markup: hidden ISO input + text input + calendar trigger + popover.
 * The text input is the field's `.field__input` — same border, focus ring,
 * padding, and floating-label rules as every other input — with the
 * calendar button sitting inside it on the left (inline-end in RTL). */
export function dateFieldHtml(opts: DateFieldOptions): string {
  const calendar = currentCalendar();
  const textValue = opts.value !== "" ? dateInputText(opts.value, calendar) : "";
  return `
    <div class="date-field" data-date-field>
      <input type="hidden" id="${escHtml(opts.fieldId)}-input" name="${escHtml(opts.name)}"
        value="${escHtml(opts.value)}" data-df-input />
      <input type="text" id="${escHtml(opts.fieldId)}" class="field__input date-field__text"
        data-df-text inputmode="numeric" autocomplete="off"
        aria-label="${escHtml(opts.label)}" value="${escHtml(textValue)}" />
      <button type="button" class="date-field__icon-btn" data-df-button
        aria-haspopup="dialog" aria-expanded="false"
        aria-label="${t("dateField.openPicker")}" title="${t("dateField.openPicker")}">
        <span data-lucide="calendar" class="date-field__icon" aria-hidden="true"></span>
      </button>
      <div class="date-field__popover" data-df-popover hidden role="dialog"
        aria-label="${escHtml(opts.label)}"></div>
    </div>
  `;
}

/** Wires every `[data-date-field]` inside `container`. Call on each render. */
export function bindDateFields(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>("[data-date-field]").forEach((root) => {
    const button = root.querySelector<HTMLButtonElement>("[data-df-button]");
    const popover = root.querySelector<HTMLElement>("[data-df-popover]");
    const input = root.querySelector<HTMLInputElement>("[data-df-input]");
    const text = root.querySelector<HTMLInputElement>("[data-df-text]");
    if (!button || !popover || !input || !text) return;

    // Only the calendar icon opens the picker; the input itself is for
    // manual entry.
    button.addEventListener("click", () => {
      if (popover.hidden) {
        openPopover(root, popover, input);
      } else {
        closePopover(root, popover);
      }
    });

    // Manual entry: commit on blur/Enter (change), never on every keystroke.
    text.addEventListener("change", () => commitTypedDate(input, text));
    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commitTypedDate(input, text);
    });
  });
  registerGlobalClose();
}

/* --- Manual entry --- */

/** Parses the typed text into the hidden ISO input (unparseable text is
 * handed to the form's existing validation; empty input clears the date). */
function commitTypedDate(input: HTMLInputElement, text: HTMLInputElement): void {
  const typed = text.value.trim();
  if (typed === "") {
    setIso(input, "");
    return;
  }
  const iso = parseTypedDate(typed, currentCalendar());
  if (iso) {
    text.value = dateInputText(iso, currentCalendar());
    setIso(input, iso);
  } else {
    // Non-empty but unparseable: keep it so submit validation reports
    // "تاریخ معتبر نیست." instead of silently dropping the entry.
    setIso(input, typed);
  }
}

/** Writes the hidden ISO and notifies the form (bubbling change). */
function setIso(input: HTMLInputElement, iso: string): void {
  input.value = iso;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** ISO → editable numeric text in the active calendar: "۱۴۰۵/۰۶/۱۴". */
function dateInputText(iso: string, calendar: CalendarPreference): string {
  const calendarIso = toCalendarIso(iso, calendar);
  if (!calendarIso) return "";
  const [year, month, day] = calendarIso.split("-");
  return faDigits(`${year}/${month}/${day}`);
}

/** Parses a typed date in the active calendar → Gregorian ISO; null when
 * unparseable. Accepts Persian or Latin digits, "-" / "/" separators (or
 * none — "14050614"), with or without leading zeros. */
function parseTypedDate(text: string, calendar: CalendarPreference): string | null {
  const latin = text
    .trim()
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[/.]/g, "-");
  const dashed =
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(latin)
      ? latin
      : /^\d{8}$/.test(latin)
        ? latin.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
        : null;
  if (!dashed) return null;
  const [year, month, day] = dashed.split("-");
  const padded = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (calendar === "jalali") return jalaliIsoToGregorianIso(padded);
  return parseIso(padded) ? padded : null;
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

/** Stores the picked date (Gregorian ISO) in both inputs, notifies the
 * form, and closes the popover. */
function selectDay(root: HTMLElement, popover: HTMLElement, iso: string): void {
  if (iso === "") return;
  const input = root.querySelector<HTMLInputElement>("[data-df-input]");
  const text = root.querySelector<HTMLInputElement>("[data-df-text]");
  if (!input || !text) return;

  input.value = iso;
  text.value = dateInputText(iso, currentCalendar());
  setIso(input, iso);
  // The text input's change keeps the floating label in sync.
  text.dispatchEvent(new Event("change", { bubbles: true }));
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

