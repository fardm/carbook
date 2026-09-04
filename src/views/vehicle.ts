import { todayIso } from "../domain/maintenance";
import { createId } from "../domain/ids";
import {
  getCurrentOdometer,
  sortReadings,
  validateOdometerEntry,
  type OdometerError,
} from "../domain/odometer";
import type { FuelType, OdometerReading, Vehicle } from "../domain/types";
import { validateVehicle, type VehicleError } from "../domain/vehicle";
import { t, type MessageKey } from "../i18n";
import { store } from "../state/store";
import { escHtml } from "../ui/escape";
import { faNum, formatDate, toLatinDigits } from "../ui/format";

/** View-local UI state (not persisted). */
interface VehicleViewState {
  editing: boolean;
  odometerForm: { open: boolean; readingId: string | null };
}

const state: VehicleViewState = { editing: false, odometerForm: { open: false, readingId: null } };

const FUEL_KEYS: Record<FuelType, MessageKey> = {
  gasoline: "vehicle.fuelGasoline",
  diesel: "vehicle.fuelDiesel",
  hybrid: "vehicle.fuelHybrid",
  electric: "vehicle.fuelElectric",
  cng: "vehicle.fuelCng",
  lpg: "vehicle.fuelLpg",
  other: "vehicle.fuelOther",
};

const ERROR_KEYS: Record<VehicleError | OdometerError, MessageKey> = {
  nameRequired: "vehicle.errorNameRequired",
  yearInvalid: "vehicle.errorYearInvalid",
  averageInvalid: "vehicle.errorAverageInvalid",
  missingDate: "vehicle.errorMissingDate",
  invalidDate: "vehicle.errorInvalidDate",
  futureDate: "vehicle.errorFutureDate",
  missingOdometer: "vehicle.errorMissingOdometer",
  invalidOdometer: "vehicle.errorInvalidOdometer",
};

const VEHICLE_ERROR_FIELD: Record<VehicleError, string> = {
  nameRequired: "vehicle-error-name",
  yearInvalid: "vehicle-error-year",
  averageInvalid: "vehicle-error-average",
};

const ODOMETER_ERROR_FIELD: Record<OdometerError, "date" | "value"> = {
  missingDate: "date",
  invalidDate: "date",
  futureDate: "date",
  missingOdometer: "value",
  invalidOdometer: "value",
};

export function renderVehicle(container: HTMLElement): () => void {
  const draw = (): void => {
    container.innerHTML = vehicleViewHtml();
    bind(container);
  };
  draw();
  return store.subscribe(draw);
}

function vehicleViewHtml(): string {
  const vehicle = store.get().vehicle;
  return `
    <div class="view-stack">
      <h1 class="view-title">${t("view.vehicle.title")}</h1>
      ${vehicle ? vehicleCardHtml(vehicle) : vehicleFormHtml(null)}
      ${vehicle ? odometerSectionHtml() : ""}
    </div>
  `;
}

function vehicleCardHtml(vehicle: Vehicle): string {
  if (state.editing) return vehicleFormHtml(vehicle);
  const rows = [
    infoRow(t("vehicle.make"), vehicle.make || null),
    infoRow(t("vehicle.model"), vehicle.model || null),
    infoRow(t("vehicle.year"), vehicle.year != null ? String(vehicle.year) : null),
    infoRow(t("vehicle.fuelType"), vehicle.fuelType ? t(FUEL_KEYS[vehicle.fuelType]) : null),
    infoRow(
      t("vehicle.averageDaily"),
      vehicle.averageDailyDistance != null
        ? `${faNum(vehicle.averageDailyDistance)} ${t("vehicle.averageDailyUnit")}`
        : null,
    ),
  ].join("");
  return `
    <section class="card">
      <div class="card__head">
        <h2 class="card__title">${escHtml(vehicle.name)}</h2>
        <button type="button" class="btn btn--text js-edit-vehicle">${t("vehicle.edit")}</button>
      </div>
      ${rows ? `<dl class="info-list">${rows}</dl>` : ""}
    </section>
  `;
}

function infoRow(label: string, value: string | null): string {
  if (!value) return "";
  return `<div class="info-list__row"><dt>${escHtml(label)}</dt><dd>${escHtml(value)}</dd></div>`;
}

function vehicleFormHtml(vehicle: Vehicle | null): string {
  const vehicleValue = (field: keyof Vehicle): string =>
    vehicle ? String(vehicle[field] ?? "") : "";

  const fuelOptions = (Object.keys(FUEL_KEYS) as FuelType[])
    .map(
      (fuel) =>
        `<option value="${fuel}" ${vehicle?.fuelType === fuel ? "selected" : ""}>${t(FUEL_KEYS[fuel])}</option>`,
    )
    .join("");

  return `
    <section class="card">
      <form id="vehicle-form" class="form" novalidate>
        <div class="form__title">${vehicle ? t("vehicle.editTitle") : t("vehicle.setupTitle")}</div>
        <div class="field">
          <label class="field__label" for="vehicle-name">${t("vehicle.name")}</label>
          <input class="field__input" id="vehicle-name" name="name" type="text"
            value="${escHtml(vehicleValue("name"))}" placeholder="${t("vehicle.namePlaceholder")}" />
          <p class="field__error" id="vehicle-error-name" hidden></p>
        </div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="vehicle-make">${t("vehicle.make")}</label>
            <input class="field__input" id="vehicle-make" name="make" type="text"
              value="${escHtml(vehicleValue("make"))}" placeholder="${t("vehicle.makePlaceholder")}" />
          </div>
          <div class="field">
            <label class="field__label" for="vehicle-model">${t("vehicle.model")}</label>
            <input class="field__input" id="vehicle-model" name="model" type="text"
              value="${escHtml(vehicleValue("model"))}" placeholder="${t("vehicle.modelPlaceholder")}" />
          </div>
          <div class="field">
            <label class="field__label" for="vehicle-year">${t("vehicle.year")}</label>
            <input class="field__input" id="vehicle-year" name="year" type="number"
              inputmode="numeric" min="1900" max="2100" step="1" value="${escHtml(vehicleValue("year"))}" />
            <p class="field__error" id="vehicle-error-year" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="vehicle-fuel">${t("vehicle.fuelType")}</label>
            <select class="field__input" id="vehicle-fuel" name="fuelType">
              <option value="">—</option>
              ${fuelOptions}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="vehicle-average">${t("vehicle.averageDaily")} (${t("vehicle.averageDailyUnit")})</label>
          <input class="field__input" id="vehicle-average" name="averageDaily" type="number"
            inputmode="decimal" min="0" step="any" value="${escHtml(vehicleValue("averageDailyDistance"))}" />
          <p class="field__hint">${t("vehicle.averageHint")}</p>
          <p class="field__error" id="vehicle-error-average" hidden></p>
        </div>
        <div class="form__actions">
          ${vehicle ? `<button type="button" class="btn btn--text js-cancel-edit">${t("common.cancel")}</button>` : ""}
          <button type="submit" class="btn btn--filled">${t("common.save")}</button>
        </div>
      </form>
    </section>
  `;
}

function odometerSectionHtml(): string {
  const dataset = store.get();
  const current = getCurrentOdometer(dataset);
  const readings = sortReadings(dataset.odometerHistory).reverse();

  const currentBlock = `
    <section class="card odometer-card">
      <div class="odometer-card__head">
        <div>
          <div class="odometer-card__label">${t("vehicle.currentOdometer")}</div>
          <div class="odometer-card__value">
            ${current ? `${faNum(current.odometer)} ${t("common.kmUnit")}` : t("vehicle.notRecorded")}
          </div>
        </div>
        ${state.odometerForm.open ? "" : `<button type="button" class="btn btn--filled js-record-odometer">${t("vehicle.recordOdometer")}</button>`}
      </div>
    </section>
  `;

  const formBlock = state.odometerForm.open ? odometerFormHtml() : "";

  const historyRows =
    readings.length === 0
      ? `<p class="history__empty">${t("vehicle.noHistory")}</p>`
      : `
        <ul class="history__list">
          ${readings
            .map(
              (reading) => `
                <li class="history__item">
                  <div>
                    <div class="history__date">${formatDate(reading.date)}</div>
                    <div class="history__km">${faNum(reading.odometer)} ${t("common.kmUnit")}</div>
                  </div>
                  <button type="button" class="btn btn--text js-edit-reading" data-id="${reading.id}">${t("vehicle.editReading")}</button>
                </li>
              `,
            )
            .join("")}
        </ul>
      `;

  return `
    ${currentBlock}
    ${formBlock}
    <section class="card history">
      <h2 class="card__title">${t("vehicle.historyTitle")}</h2>
      ${historyRows}
    </section>
  `;
}

function odometerFormHtml(): string {
  const reading = state.odometerForm.readingId
    ? (store.get().odometerHistory.find((r) => r.id === state.odometerForm.readingId) ?? null)
    : null;
  const title = reading ? t("vehicle.editReadingTitle") : t("vehicle.recordTitle");
  return `
    <section class="card">
      <form id="odometer-form" class="form" novalidate>
        <div class="form__title">${title}</div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="odometer-date">${t("vehicle.dateLabel")}</label>
            <input class="field__input" id="odometer-date" name="date" type="date"
              value="${reading ? reading.date : todayIso()}" />
            <p class="field__error" id="odometer-error-date" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="odometer-value">${t("vehicle.valueLabel")} (${t("common.kmUnit")})</label>
            <input class="field__input" id="odometer-value" name="odometer" type="number"
              inputmode="numeric" min="0" step="1" value="${reading ? reading.odometer : ""}" />
            <p class="field__error" id="odometer-error-value" hidden></p>
            <p class="field__warn" id="odometer-warnings" hidden></p>
          </div>
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-cancel-odometer">${t("common.cancel")}</button>
          <button type="submit" class="btn btn--filled">${t("common.save")}</button>
        </div>
      </form>
    </section>
  `;
}

function bind(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>(".js-edit-vehicle")?.addEventListener("click", () => {
    state.editing = true;
    redraw(container);
  });
  container.querySelector<HTMLButtonElement>(".js-cancel-edit")?.addEventListener("click", () => {
    state.editing = false;
    redraw(container);
  });
  container.querySelector<HTMLButtonElement>(".js-record-odometer")?.addEventListener("click", () => {
    state.odometerForm = { open: true, readingId: null };
    redraw(container);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-edit-reading").forEach((button) => {
    button.addEventListener("click", () => {
      state.odometerForm = { open: true, readingId: button.dataset.id ?? null };
      redraw(container);
    });
  });
  container.querySelector<HTMLButtonElement>(".js-cancel-odometer")?.addEventListener("click", () => {
    state.odometerForm = { open: false, readingId: null };
    redraw(container);
  });

  container.querySelector<HTMLFormElement>("#vehicle-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitVehicleForm(container, event.currentTarget as HTMLFormElement);
  });

  container.querySelector<HTMLFormElement>("#odometer-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitOdometerForm(container, event.currentTarget as HTMLFormElement);
  });

  container.querySelector<HTMLInputElement>("#odometer-value")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const raw = input.value.trim();
    renderOdometerWarnings(container, raw === "" ? null : Number(toLatinDigits(raw)));
  });
}

/** Re-renders without notifying the store (pure view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = vehicleViewHtml();
  bind(container);
}

function submitVehicleForm(container: HTMLElement, form: HTMLFormElement): void {
  const data = new FormData(form);
  const name = String(data.get("name") ?? "").trim();
  const make = String(data.get("make") ?? "").trim();
  const model = String(data.get("model") ?? "").trim();
  const yearRaw = String(data.get("year") ?? "").trim();
  const averageRaw = String(data.get("averageDaily") ?? "").trim();
  const fuelRaw = String(data.get("fuelType") ?? "");

  const input = {
    name,
    make,
    model,
    year: yearRaw === "" ? null : Number(toLatinDigits(yearRaw)),
    fuelType: (fuelRaw === "" ? null : fuelRaw) as FuelType | null,
    averageDailyDistance: averageRaw === "" ? null : Number(toLatinDigits(averageRaw)),
  };

  const errors = validateVehicle(input);
  if (errors.length > 0) {
    showFieldErrors(container, errors.map((error) => [VEHICLE_ERROR_FIELD[error], t(ERROR_KEYS[error])]));
    return;
  }

  state.editing = false;
  store.update((draft) => {
    const now = new Date().toISOString();
    if (draft.vehicle) {
      draft.vehicle = { ...draft.vehicle, ...input, updatedAt: now };
    } else {
      draft.vehicle = { id: createId(), ...input, createdAt: now, updatedAt: now };
    }
  });
}

function submitOdometerForm(container: HTMLElement, form: HTMLFormElement): void {
  const data = new FormData(form);
  const date = String(data.get("date") ?? "");
  const valueRaw = String(data.get("odometer") ?? "").trim();
  const odometer = valueRaw === "" ? null : Number(toLatinDigits(valueRaw));
  const readingId = state.odometerForm.readingId;

  const { errors } = validateOdometerEntry(
    { date, odometer },
    { today: todayIso(), latest: latestExcluding(readingId) },
  );
  if (errors.length > 0) {
    showFieldErrors(
      container,
      errors.map((error) => [`odometer-error-${ODOMETER_ERROR_FIELD[error]}`, t(ERROR_KEYS[error])]),
    );
    return;
  }

  state.odometerForm = { open: false, readingId: null };
  store.update((draft) => {
    const now = new Date().toISOString();
    if (readingId) {
      const record = draft.odometerHistory.find((r) => r.id === readingId);
      if (record && odometer != null) {
        record.date = date;
        record.odometer = odometer;
      }
    } else if (odometer != null) {
      draft.odometerHistory.push({ id: createId(), date, odometer, createdAt: now });
    }
  });
}

/** The latest reading, ignoring the one currently being edited. */
function latestExcluding(readingId: string | null): OdometerReading | null {
  const readings = store.get().odometerHistory.filter((reading) => reading.id !== readingId);
  const sorted = sortReadings(readings);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

function renderOdometerWarnings(container: HTMLElement, value: number | null): void {
  const element = container.querySelector<HTMLElement>("#odometer-warnings");
  if (!element) return;
  const latest = latestExcluding(state.odometerForm.readingId);
  const warnings =
    value != null && latest != null
      ? validateOdometerEntry({ date: todayIso(), odometer: value }, { today: todayIso(), latest }).warnings
      : [];
  if (warnings.length === 0) {
    element.hidden = true;
    return;
  }
  const texts = warnings.map(({ kind, delta }) => {
    const amount = `${faNum(Math.abs(delta))} ${t("common.kmUnit")}`;
    if (kind === "decrease") return `${t("vehicle.warnDecrease")} (${amount})`;
    return `${t("vehicle.warnLargeIncrease")} (${amount})`;
  });
  element.textContent = texts.join(" ");
  element.hidden = false;
}

function showFieldErrors(container: HTMLElement, errors: [string, string][]): void {
  for (const [id, message] of errors) {
    const element = container.querySelector<HTMLElement>(`#${id}`);
    if (element) {
      element.textContent = message;
      element.hidden = false;
    }
  }
}