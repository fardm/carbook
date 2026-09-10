// @vitest-environment jsdom
/**
 * Date-field picker UX (month/year quick navigation).
 *
 * Covers the click-to-select header flow: heading → year page → month
 * grid → day grid, plus regression checks that the existing behaviors —
 * typing, prev/next month stepping, today shortcut, and ISO storage —
 * are unchanged. The store's calendar preference (Jalali by default)
 * drives every assertion through the real calendar conversion.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { bindDateFields, dateFieldHtml } from "../src/ui/date-field";
import { defaultDataset } from "../src/domain/defaults";
import { store } from "../src/state/store";

const LABEL = "تاریخ آخرین سرویس";

function mount(value = ""): {
  root: HTMLElement;
  popover: HTMLElement;
  input: HTMLInputElement;
  text: HTMLInputElement;
} {
  const container = document.createElement("div");
  container.innerHTML = dateFieldHtml({
    fieldId: "last-service-date",
    name: "last_service_date",
    value,
    label: LABEL,
  });
  document.body.append(container);
  bindDateFields(container);

  const root = container.querySelector<HTMLElement>("[data-date-field]")!;
  const popover = root.querySelector<HTMLElement>("[data-df-popover]")!;
  const input = root.querySelector<HTMLInputElement>("[data-df-input]")!;
  const text = root.querySelector<HTMLInputElement>("[data-df-text]")!;
  return { root, popover, input, text };
}

function open(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("[data-df-button]")!.click();
}

function click(popover: HTMLElement, selector: string, attribute: string, value: string): void {
  const button = popover.querySelector<HTMLButtonElement>(`[${attribute}="${value}"]`);
  if (!button) throw new Error(`missing button ${selector} for ${attribute}="${value}"`);
  button.click();
}

function heading(popover: HTMLElement): HTMLButtonElement {
  return popover.querySelector<HTMLButtonElement>("[data-df-heading]")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
  store.replace(defaultDataset()); // calendar: "jalali"
});

describe("day grid (default view)", () => {
  it("opens at the current value's month with the day grid", () => {
    const { root, popover } = mount("2026-09-04"); // 13 شهریور ۱۴۰۵
    open(root);
    expect(heading(popover).textContent).toContain("شهریور");
    expect(heading(popover).textContent).toContain("۱۴۰۵");
    expect(popover.querySelectorAll("[data-df-day]").length).toBe(31); // شهریور
  });

  it("opens at today's month when no value is set", () => {
    const { root, popover } = mount();
    open(root);
    expect(popover.querySelectorAll("[data-df-day].date-field__day--today").length).toBe(1);
  });

  it("‹ / › still step one month at a time", () => {
    const { root, popover } = mount("2026-09-04");
    open(root);
    popover.querySelector<HTMLButtonElement>("[data-df-prev]")!.click();
    expect(heading(popover).textContent).toContain("مرداد");
    popover.querySelector<HTMLButtonElement>("[data-df-next]")!.click();
    popover.querySelector<HTMLButtonElement>("[data-df-next]")!.click();
    expect(heading(popover).textContent).toContain("مهر");
  });

  it("picking a day stores the Gregorian ISO and closes the popover", () => {
    const { root, popover, input, text } = mount("2026-09-04");
    open(root);
    click(popover, "day", "data-df-day", "2026-09-01"); // ۱۰ شهریور ۱۴۰۵
    expect(input.value).toBe("2026-09-01");
    expect(text.value).toBe("۱۴۰۵/۰۶/۱۰");
    expect(popover.hidden).toBe(true);
  });
});

describe("click-to-select header — Jalali", () => {
  it("heading → year page of 12 years ending at the viewed year", () => {
    const { root, popover } = mount("2026-09-04"); // ۱۴۰۵
    open(root);
    heading(popover).click();
    const years = [...popover.querySelectorAll<HTMLButtonElement>("[data-df-year]")];
    expect(years.length).toBe(12);
    expect(years[0].textContent).toBe("۱۳۹۴");
    expect(years[11].textContent).toBe("۱۴۰۵");
    expect(popover.querySelector(".date-field__choice--selected")!.textContent).toBe("۱۴۰۵");
  });

  it("‹ / › page the year grid by 12", () => {
    const { root, popover } = mount("2026-09-04");
    open(root);
    heading(popover).click();
    popover.querySelectorAll<HTMLButtonElement>("[data-df-year-page]")[1]!.click();
    const years = [...popover.querySelectorAll<HTMLButtonElement>("[data-df-year]")];
    expect(years[0].textContent).toBe("۱۴۰۶");
    expect(years[11].textContent).toBe("۱۴۱۷");
  });

  it("year click → month grid of that year (selected month highlighted)", () => {
    const { root, popover } = mount("2026-09-04"); // ۱۴۰۵/۰۶
    open(root);
    heading(popover).click();
    click(popover, "year", "data-df-year", "1403");
    expect(heading(popover).textContent!.trim()).toBe("۱۴۰۳");
    const months = [...popover.querySelectorAll<HTMLButtonElement>("[data-df-month]")];
    expect(months.length).toBe(12);
    // The picked date (۱۴۰۵/۰۶/۱۴) is not in ۱۴۰۳ → no month highlighted.
    expect(months.some((m) => m.classList.contains("date-field__choice--selected"))).toBe(false);
  });

  it("highlights the selected month only in its own year's grid", () => {
    const { root, popover } = mount("2026-09-04"); // ۱۴۰۵/۰۶/۱۴
    open(root);
    heading(popover).click();
    click(popover, "year", "data-df-year", "1405");
    const months = [...popover.querySelectorAll<HTMLButtonElement>("[data-df-month]")];
    expect(months[5].textContent).toBe("شهریور");
    expect(months[5].classList.contains("date-field__choice--selected")).toBe(true);
  });

  it("month click → day grid of the chosen Jalali month", () => {
    const { root, popover } = mount("2026-09-04");
    open(root);
    heading(popover).click();
    click(popover, "year", "data-df-year", "1403");
    click(popover, "month", "data-df-month", "1");
    expect(heading(popover).textContent).toContain("فروردین");
    expect(heading(popover).textContent).toContain("۱۴۰۳");
    // 1 فروردین ۱۴۰۳ = 20 March 2024, a Thursday → 5 leading blanks.
    expect(popover.querySelector(".date-field__day--empty")!.previousElementSibling).toBeNull();
  });

  it("the full two-click jump lands on the right Gregorian ISO", () => {
    const { root, popover, input } = mount("2026-09-04");
    open(root);
    heading(popover).click();
    click(popover, "year", "data-df-year", "1404"); // ۱۴۰۴
    click(popover, "month", "data-df-month", "12"); // اسفند
    click(popover, "day", "data-df-day", "2026-03-20"); // ۲۹ اسفند ۱۴۰۴
    expect(input.value).toBe("2026-03-20");
  });

  it("heading in the year view goes back to the month view of the same year", () => {
    const { root, popover } = mount("2026-09-04");
    open(root);
    heading(popover).click(); // year page (۱۴۰۵)
    heading(popover).click(); // → month grid of ۱۴۰۵
    expect(heading(popover).textContent!.trim()).toBe("۱۴۰۵");
    expect(popover.querySelectorAll("[data-df-month]").length).toBe(12);
  });

  it("years outside the supported range are disabled", () => {
    const { root, popover } = mount("2026-09-04");
    open(root);
    heading(popover).click();
    // Page twice back: ۱۳۸۲–۱۳۹۳ … down to a page containing < 1300.
    const pagesBack = 9; // 1405 - 9*12 = 1297
    for (let i = 0; i < pagesBack; i += 1) {
      popover.querySelectorAll<HTMLButtonElement>("[data-df-year-page]")[0]!.click();
    }
    const disabled = [...popover.querySelectorAll<HTMLButtonElement>("[data-df-year]:disabled")];
    expect(disabled.length).toBeGreaterThanOrEqual(1);
    expect(disabled.some((b) => b.textContent === "۱۲۹۷")).toBe(true);
  });
});

describe("click-to-select header — Gregorian", () => {
  beforeEach(() => {
    const dataset = defaultDataset();
    dataset.settings.calendar = "gregorian";
    store.replace(dataset);
  });

  it("shows Gregorian years and months and stores the same ISO", () => {
    const { root, popover, input } = mount("2026-09-04");
    open(root);
    expect(heading(popover).textContent).toContain("سپتامبر");
    heading(popover).click();
    const years = [...popover.querySelectorAll<HTMLButtonElement>("[data-df-year]")];
    expect(years[11].textContent).toBe("۲۰۲۶");
    click(popover, "year", "data-df-year", "2024");
    expect(heading(popover).textContent!.trim()).toBe("۲۰۲۴");
    click(popover, "month", "data-df-month", "2"); // فوریه ۲۰۲۴ (leap)
    expect(popover.querySelectorAll("[data-df-day]").length).toBe(29);
    click(popover, "day", "data-df-day", "2024-02-29");
    expect(input.value).toBe("2024-02-29");
  });

  it("highlights the selected Gregorian month in the month grid", () => {
    const { root, popover } = mount("2026-09-04");
    open(root);
    heading(popover).click();
    click(popover, "year", "data-df-year", "2026");
    const selected = popover.querySelector(".date-field__choice--selected")!;
    expect(selected.textContent).toBe("سپتامبر");
  });
});

describe("manual typing is unchanged", () => {
  it("typed dates still parse through the same calendar conversion", () => {
    const { input, text } = mount();
    text.value = "۱۴۰۵/۰۶/۱۴";
    text.dispatchEvent(new Event("change"));
    expect(input.value).toBe("2026-09-05");
  });
});
