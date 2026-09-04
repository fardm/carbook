import { createId } from "../domain/ids";
import { validateMileage, type OdometerValueError } from "../domain/odometer";
import type { FuelType, Vehicle } from "../domain/types";
import { validateVehicle, type VehicleError } from "../domain/vehicle";
import { t, type MessageKey } from "../i18n";
import { store } from "../state/store";
import { escHtml } from "../ui/escape";
import { faNum, formatDate, toLatinDigits } from "../ui/format";
import { applyIcons } from "../ui/icons";

/**
 * Vehicle view — the multi-vehicle garage ("خودروها", the default page).
 *
 * - Each vehicle is a full-width single-row card: icon + name on the start
 *   (right) side, the current mileage column on the end (left) side with a
 *   "last mileage update" date underneath and a بروزرسانی کیلومتر action,
 *   and a three-dot menu opening a proper dropdown (ویرایش /
 *   انتخاب به عنوان پیشفرض / حذف).
 * - The default vehicle gets a subtle primary outline; the Services page
 *   auto-selects it.
 * - Empty garage: a centered افزودن خودرو button only. With vehicles, the
 *   same button stays centered above the list.
 * - Add/Edit modal (ویرایش → انصراف / ثبت تغییرات / حذف خودرو) and a
 *   dedicated delete-confirm modal. Deleting a vehicle permanently removes
 *   the vehicle AND all of its maintenance items / service / inspection
 *   history (cascade delete) and clears the default preference.
 */

interface VehicleViewState {
  /** Open modal; null = none. */
  modal:
    | { kind: "add" }
    | { kind: "edit"; vehicleId: string; confirmDelete: boolean }
    | { kind: "delete"; vehicleId: string }
    | { kind: "mileage"; vehicleId: string }
    | null;
  /** Vehicle whose three-dot menu is open; null = none. */
  menuVehicleId: string | null;
  /** Typed form values keyed by input name (survive re-renders). */
  formValues: Record<string, string>;
}

const state: VehicleViewState = { modal: null, menuVehicleId: null, formValues: {} };

const FUEL_KEYS: Record<FuelType, MessageKey> = {
  gasoline: "vehicle.fuelGasoline",
  diesel: "vehicle.fuelDiesel",
  hybrid: "vehicle.fuelHybrid",
  electric: "vehicle.fuelElectric",
  cng: "vehicle.fuelCng",
  lpg: "vehicle.fuelLpg",
  other: "vehicle.fuelOther",
};

const ERROR_KEYS: Record<VehicleError | OdometerValueError, MessageKey> = {
  nameRequired: "vehicle.errorNameRequired",
  yearInvalid: "vehicle.errorYearInvalid",
  averageInvalid: "vehicle.errorAverageInvalid",
  missingOdometer: "vehicle.errorMissingOdometer",
  invalidOdometer: "vehicle.errorInvalidOdometer",
};

const VEHICLE_ERROR_FIELD: Record<VehicleError, string> = {
  nameRequired: "vehicle-error-name",
  yearInvalid: "vehicle-error-year",
  averageInvalid: "vehicle-error-average",
};

export function renderVehicle(container: HTMLElement): () => void {
  const draw = (): void => {
    container.innerHTML = vehicleViewHtml();
    bind(container);
    applyIcons();
  };
  draw();
  return store.subscribe(draw);
}

/* --- Layout --- */

function vehicleViewHtml(): string {
  const dataset = store.get();
  const vehicles = dataset.vehicles;
  const topAction = vehicles.length > 0
    ? `
      <div class="vehicles-top">
        <button type="button" class="btn btn--filled js-add-vehicle">
          <span data-lucide="plus"></span>
          ${t("vehicle.addVehicle")}
        </button>
      </div>`
    : "";
  const body =
    vehicles.length === 0
      ? emptyStateHtml()
      : `<div class="vehicle-list">${vehicles.map((v) => vehicleRowHtml(v, dataset.settings.defaultVehicleId)).join("")}</div>`;
  return `
    <div class="view-stack">
      <h1 class="view-title">${t("view.vehicle.title")}</h1>
      ${topAction}
      ${body}
      ${modalHtml()}
    </div>
  `;
}

function emptyStateHtml(): string {
  return `
    <section class="card vehicles-empty">
      <button type="button" class="btn btn--filled js-add-vehicle">
        <span data-lucide="plus"></span>
        ${t("vehicle.addVehicle")}
      </button>
    </section>
  `;
}

/** The short metadata line under the name: make — model — production year. */
function vehicleMeta(vehicle: Vehicle): string {
  return [vehicle.make, vehicle.model, vehicle.year != null ? String(vehicle.year) : ""]
    .filter((part) => part !== "")
    .join(" — ");
}

function vehicleRowHtml(vehicle: Vehicle, defaultVehicleId: string | null): string {
  const meta = vehicleMeta(vehicle);
  const isDefault = vehicle.id === defaultVehicleId;
  const mileage = vehicle.currentOdometer;
  const updatedAt = vehicle.odometerUpdatedAt;
  const menuOpen = state.menuVehicleId === vehicle.id;

  return `
    <section class="card vehicle-row${isDefault ? " vehicle-row--default" : ""}">
      <div class="vehicle-row__main">
        <span class="vehicle-row__icon" data-lucide="car-front"></span>
        <div class="vehicle-row__info">
          <div class="vehicle-row__name">${escHtml(vehicle.name)}</div>
          ${meta ? `<div class="vehicle-row__meta">${escHtml(meta)}</div>` : ""}
        </div>
      </div>

      <div class="vehicle-row__mileage">
        <div class="vehicle-row__mileage-value">
          <span data-lucide="gauge"></span>
          <span>${mileage != null ? `${faNum(mileage)} ${t("common.kmUnit")}` : t("vehicle.notRecorded")}</span>
        </div>
        ${
          updatedAt
            ? `<div class="vehicle-row__mileage-updated" aria-label="${t("vehicle.mileageUpdated")}">${formatDate(updatedAt.slice(0, 10))}</div>`
            : ""
        }
        <button type="button" class="btn btn--text vehicle-row__update js-update-mileage" data-id="${escHtml(vehicle.id)}">
          <span data-lucide="refresh-cw"></span>
          ${t("vehicle.updateMileage")}
        </button>
      </div>

      <div class="card-menu">
        <button type="button" class="icon-btn js-menu-toggle" data-id="${escHtml(vehicle.id)}"
          aria-haspopup="menu" aria-expanded="${menuOpen}" aria-label="${t("vehicle.menuLabel")}">
          <span data-lucide="more-vertical"></span>
        </button>
        ${menuOpen ? cardMenuPopoverHtml(vehicle.id, isDefault) : ""}
      </div>
    </section>
  `;
}

/** Dropdown popover + full-screen click-away backdrop for the three-dot menu. */
function cardMenuPopoverHtml(vehicleId: string, isDefault: boolean): string {
  return `
    <div class="card-menu__backdrop js-menu-backdrop"></div>
    <div class="card-menu__popover" role="menu" aria-label="${t("vehicle.menuLabel")}">
      <button type="button" class="card-menu__item js-menu-edit" role="menuitem" data-id="${escHtml(vehicleId)}">
        <span data-lucide="pencil"></span>
        ${t("vehicle.edit")}
      </button>
      <button type="button" class="card-menu__item js-menu-default" role="menuitem" data-id="${escHtml(vehicleId)}"
        ${isDefault ? 'aria-disabled="true"' : ""}>
        <span data-lucide="star"></span>
        ${t("vehicle.makeDefault")}
        ${isDefault ? `<span class="card-menu__check" data-lucide="check"></span>` : ""}
      </button>
      <div class="card-menu__divider" role="separator"></div>
      <button type="button" class="card-menu__item card-menu__item--danger js-menu-delete" role="menuitem" data-id="${escHtml(vehicleId)}">
        <span data-lucide="trash-2"></span>
        ${t("vehicle.deleteVehicle")}
      </button>
    </div>
  `;
}

/* --- Modal --- */

function modalHtml(): string {
  const modal = state.modal;
  if (!modal) return "";
  if (modal.kind === "add" || modal.kind === "edit") {
    const vehicle = modal.kind === "edit"
      ? (store.get().vehicles.find((v) => v.id === modal.vehicleId) ?? null)
      : null;
    return `<div class="modal-overlay">${vehicleFormModalHtml(vehicle, modal.kind === "edit" && modal.confirmDelete)}</div>`;
  }
  const vehicle = store.get().vehicles.find((v) => v.id === modal.vehicleId) ?? null;
  if (modal.kind === "delete") {
    return `<div class="modal-overlay">${deleteModalHtml(vehicle)}</div>`;
  }
  return `<div class="modal-overlay">${mileageModalHtml(vehicle)}</div>`;
}

/** Form value helper (survives re-renders, same pattern as the item form). */
function formValue(field: string, fallback: string = ""): string {
  return state.formValues[field] ?? fallback;
}

function vehicleFormModalHtml(vehicle: Vehicle | null, confirmDelete: boolean): string {
  const editing = vehicle != null;
  const fuelOptions = (Object.keys(FUEL_KEYS) as FuelType[])
    .map(
      (fuel) =>
        `<option value="${fuel}" ${vehicle?.fuelType === fuel ? "selected" : ""}>${t(FUEL_KEYS[fuel])}</option>`,
    )
    .join("");
  const field = (name: string, get: () => string | null): string =>
    formValue(name, editing && vehicle ? get() ?? "" : "");

  return `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${editing ? t("vehicle.editTitle") : t("vehicle.setupTitle")}">
      <form id="vehicle-modal-form" class="form" novalidate>
        <div class="form__title">${editing ? t("vehicle.editTitle") : t("vehicle.setupTitle")}</div>
        ${confirmDelete ? deleteConfirmBlock() : ""}
        <div class="field">
          <label class="field__label" for="vehicle-name">${t("vehicle.name")}</label>
          <input class="field__input" id="vehicle-name" name="name" type="text"
            value="${escHtml(field("name", () => vehicle?.name ?? null))}"
            placeholder="${t("vehicle.namePlaceholder")}" ${confirmDelete ? "disabled" : ""} />
          <p class="field__error" id="vehicle-error-name" hidden></p>
        </div>
        <div class="form__grid">
          <div class="field">
            <label class="field__label" for="vehicle-make">${t("vehicle.make")}</label>
            <input class="field__input" id="vehicle-make" name="make" type="text"
              value="${escHtml(field("make", () => vehicle?.make ?? null))}"
              placeholder="${t("vehicle.makePlaceholder")}" ${confirmDelete ? "disabled" : ""} />
          </div>
          <div class="field">
            <label class="field__label" for="vehicle-model">${t("vehicle.model")}</label>
            <input class="field__input" id="vehicle-model" name="model" type="text"
              value="${escHtml(field("model", () => vehicle?.model ?? null))}"
              placeholder="${t("vehicle.modelPlaceholder")}" ${confirmDelete ? "disabled" : ""} />
          </div>
          <div class="field">
            <label class="field__label" for="vehicle-year">${t("vehicle.year")}</label>
            <input class="field__input" id="vehicle-year" name="year" type="number"
              inputmode="numeric" min="1300" max="2100" step="1"
              value="${escHtml(field("year", () => (vehicle?.year != null ? String(vehicle.year) : null)))}"
              ${confirmDelete ? "disabled" : ""} />
            <p class="field__hint">${t("vehicle.yearHint")}</p>
            <p class="field__error" id="vehicle-error-year" hidden></p>
          </div>
          <div class="field">
            <label class="field__label" for="vehicle-fuel">${t("vehicle.fuelType")}</label>
            <select class="field__input" id="vehicle-fuel" name="fuelType" ${confirmDelete ? "disabled" : ""}>
              <option value="">—</option>
              ${fuelOptions}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="vehicle-average">${t("vehicle.averageDaily")} (${t("vehicle.averageDailyUnit")})</label>
          <input class="field__input" id="vehicle-average" name="averageDaily" type="number"
            inputmode="decimal" min="0" step="any"
            value="${escHtml(field("averageDaily", () => (vehicle?.averageDailyDistance != null ? String(vehicle.averageDailyDistance) : null)))}"
            ${confirmDelete ? "disabled" : ""} />
          <p class="field__hint">${t("vehicle.averageHint")}</p>
          <p class="field__error" id="vehicle-error-average" hidden></p>
        </div>
        <div class="form__actions vehicle-modal-actions">
          <button type="button" class="btn btn--text js-cancel-modal">${t("common.cancel")}</button>
          ${editing ? `<button type="button" class="btn btn--text btn--danger-text js-delete-vehicle">${t("vehicle.deleteVehicle")}</button>` : ""}
          ${!confirmDelete ? `<button type="submit" class="btn btn--filled">${editing ? t("vehicle.saveChanges") : t("vehicle.saveVehicle")}</button>` : ""}
        </div>
      </form>
    </div>
  `;
}

function deleteConfirmBlock(): string {
  return `
    <div class="box box--danger" role="alert">
      <span data-lucide="triangle-alert"></span>
      <span>${t("vehicle.deleteConfirm")}</span>
    </div>
    <div class="form__actions">
      <button type="button" class="btn btn--text js-cancel-delete-vehicle">${t("common.cancel")}</button>
      <button type="button" class="btn btn--danger js-confirm-delete-vehicle">${t("vehicle.confirmDelete")}</button>
    </div>
  `;
}

/** Standalone delete confirmation (from the card menu's حذف item). */
function deleteModalHtml(vehicle: Vehicle | null): string {
  const name = vehicle ? escHtml(vehicle.name) : "";
  return `
    <div class="modal" role="alertdialog" aria-modal="true" aria-label="${t("vehicle.deleteVehicle")}">
      <div class="form">
        <div class="form__title">${t("vehicle.deleteVehicle")}</div>
        <div class="box box--danger" role="alert">
          <span data-lucide="triangle-alert"></span>
          <span>${t("vehicle.deleteConfirm")}${name ? ` «${name}»` : ""}</span>
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-cancel-modal">${t("common.cancel")}</button>
          <button type="button" class="btn btn--danger js-confirm-delete-vehicle">${t("vehicle.confirmDelete")}</button>
        </div>
      </div>
    </div>
  `;
}

function mileageModalHtml(vehicle: Vehicle | null): string {
  const name = vehicle ? escHtml(vehicle.name) : "";
  return `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${t("vehicle.updateMileage")}">
      <form id="mileage-form" class="form" novalidate>
        <div class="form__title">${t("vehicle.updateMileage")}</div>
        ${vehicle ? `<p class="card__text">${t("vehicle.mileageFor")}: ${name}</p>` : ""}
        <div class="field">
          <label class="field__label" for="mileage-value">${t("vehicle.mileageLabel")} (${t("common.kmUnit")})</label>
          <input class="field__input" id="mileage-value" name="mileage" type="number"
            inputmode="numeric" min="0" step="1" autofocus
            value="${escHtml(formValue("mileage", vehicle?.currentOdometer != null ? String(vehicle.currentOdometer) : ""))}" />
          <p class="field__hint">${t("vehicle.mileageHint")}</p>
          <p class="field__error" id="mileage-error" hidden></p>
        </div>
        <div class="form__actions">
          <button type="button" class="btn btn--text js-cancel-modal">${t("common.cancel")}</button>
          <button type="submit" class="btn btn--filled">${t("common.save")}</button>
        </div>
      </form>
    </div>
  `;
}

/* --- Events --- */

function bind(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>(".js-add-vehicle").forEach((button) => {
    button.addEventListener("click", () => {
      state.modal = { kind: "add" };
      state.menuVehicleId = null;
      state.formValues = {};
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-update-mileage").forEach((button) => {
    button.addEventListener("click", () => {
      state.modal = { kind: "mileage", vehicleId: button.dataset.id ?? "" };
      state.menuVehicleId = null;
      state.formValues = {};
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-cancel-modal").forEach((button) => {
    button.addEventListener("click", () => {
      state.modal = null;
      state.formValues = {};
      redraw(container);
    });
  });
  container.querySelector<HTMLButtonElement>(".js-delete-vehicle")?.addEventListener("click", () => {
    if (state.modal?.kind !== "edit") return;
    state.modal = { ...state.modal, confirmDelete: true };
    redraw(container);
  });
  container.querySelector<HTMLButtonElement>(".js-cancel-delete-vehicle")?.addEventListener("click", () => {
    if (state.modal?.kind !== "edit") return;
    state.modal = { ...state.modal, confirmDelete: false };
    redraw(container);
  });
  container.querySelector<HTMLButtonElement>(".js-confirm-delete-vehicle")?.addEventListener("click", () => {
    const modal = state.modal;
    if (modal?.kind !== "edit" && modal?.kind !== "delete") return;
    deleteVehicle(modal.vehicleId);
    state.modal = null;
    state.formValues = {};
    redraw(container);
  });

  /* Three-dot menu: toggle + click-away backdrop + items. */
  container.querySelectorAll<HTMLButtonElement>(".js-menu-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id ?? null;
      state.menuVehicleId = state.menuVehicleId === id ? null : id;
      redraw(container);
    });
  });
  container.querySelector<HTMLElement>(".js-menu-backdrop")?.addEventListener("click", () => {
    state.menuVehicleId = null;
    redraw(container);
  });
  container.querySelectorAll<HTMLButtonElement>(".js-menu-edit").forEach((button) => {
    button.addEventListener("click", () => {
      state.modal = { kind: "edit", vehicleId: button.dataset.id ?? "", confirmDelete: false };
      state.menuVehicleId = null;
      state.formValues = {};
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-menu-delete").forEach((button) => {
    button.addEventListener("click", () => {
      state.modal = { kind: "delete", vehicleId: button.dataset.id ?? "" };
      state.menuVehicleId = null;
      redraw(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".js-menu-default").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      const id = button.dataset.id ?? "";
      state.menuVehicleId = null;
      store.update((draft) => {
        draft.settings.defaultVehicleId = id;
      });
    });
  });

  // Re-render-safe value capture (decision 31 pattern).
  const modalForm = container.querySelector<HTMLFormElement>("#vehicle-modal-form");
  modalForm?.addEventListener("input", captureValue);
  modalForm?.addEventListener("change", captureValue);
  modalForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitVehicleForm(container, event.currentTarget as HTMLFormElement);
  });
  const mileageForm = container.querySelector<HTMLFormElement>("#mileage-form");
  mileageForm?.addEventListener("input", captureValue);
  mileageForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitMileageForm(container, event.currentTarget as HTMLFormElement);
  });
}

function captureValue(event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  if (!target || !target.name) return;
  state.formValues[target.name] = target.value;
}

/** Permanently removes the vehicle and ALL of its data (cascade). Also
 * clears the default-vehicle preference when it pointed at this car. */
function deleteVehicle(vehicleId: string): void {
  store.update((draft) => {
    draft.vehicles = draft.vehicles.filter((v) => v.id !== vehicleId);
    draft.maintenanceItems = draft.maintenanceItems.filter((item) => item.vehicleId !== vehicleId);
    draft.serviceHistory = draft.serviceHistory.filter((record) => record.vehicleId !== vehicleId);
    draft.inspectionHistory = draft.inspectionHistory.filter((record) => record.vehicleId !== vehicleId);
    if (draft.settings.defaultVehicleId === vehicleId) {
      draft.settings.defaultVehicleId = null;
    }
  });
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

  const modal = state.modal;
  const now = new Date().toISOString();
  if (modal?.kind === "edit") {
    const vehicleId = modal.vehicleId;
    state.modal = null;
    state.formValues = {};
    store.update((draft) => {
      const vehicle = draft.vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) return;
      vehicle.name = name;
      vehicle.make = make;
      vehicle.model = model;
      vehicle.year = input.year;
      vehicle.fuelType = input.fuelType;
      vehicle.averageDailyDistance = input.averageDailyDistance;
      vehicle.updatedAt = now;
    });
    return;
  }

  // Add — the garage is empty for a brand-new vehicle.
  state.modal = null;
  state.formValues = {};
  store.update((draft) => {
    draft.vehicles.push({
      id: createId(),
      ...input,
      currentOdometer: null,
      odometerUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

function submitMileageForm(container: HTMLElement, form: HTMLFormElement): void {
  const modal = state.modal;
  if (modal?.kind !== "mileage") return;
  const data = new FormData(form);
  const raw = String(data.get("mileage") ?? "").trim();
  const value = raw === "" ? null : Number(toLatinDigits(raw));

  const errors = validateMileage(value);
  if (errors.length > 0) {
    const element = container.querySelector<HTMLElement>("#mileage-error");
    if (element) {
      element.textContent = t(ERROR_KEYS[errors[0]]);
      element.hidden = false;
    }
    return;
  }

  const vehicleId = modal.vehicleId;
  state.modal = null;
  state.formValues = {};
  store.update((draft) => {
    const vehicle = draft.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle || value == null) return;
    const now = new Date().toISOString();
    vehicle.currentOdometer = value;
    vehicle.odometerUpdatedAt = now;
    vehicle.updatedAt = now;
  });
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

/** Re-renders without notifying the store (pure view-local transitions). */
function redraw(container: HTMLElement): void {
  container.innerHTML = vehicleViewHtml();
  bind(container);
  applyIcons();
}
