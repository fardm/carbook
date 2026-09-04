import { createId } from "../domain/ids";
import { validateMileage, type OdometerValueError } from "../domain/odometer";
import type { Vehicle } from "../domain/types";
import { validateVehicle, type VehicleError } from "../domain/vehicle";
import { t, type MessageKey } from "../i18n";
import { store } from "../state/store";
import { escHtml } from "../ui/escape";
import { alignFabBar } from "../ui/fab";
import { bindFloatingFields } from "../ui/floating-field";
import { faNum, toLatinDigits } from "../ui/format";
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
 * - The افزودن خودرو action lives in a floating bottom action bar so it is
 *   always reachable without scrolling (empty garage included).
 * - Add/Edit modal (ویرایش → انصراف / ثبت تغییرات / حذف خودرو) and a
 *   dedicated delete-confirm modal. Deleting a vehicle permanently removes
 *   the vehicle AND all of its maintenance items / service / inspection
 *   history (cascade delete) and clears the default preference.
 */

interface VehicleViewState {
  /** Open modal; null = none. */
  modal:
    | { kind: "add" }
    | { kind: "edit"; vehicleId: string }
    | { kind: "delete"; vehicleId: string }
    | { kind: "mileage"; vehicleId: string }
    | null;
  /** Vehicle whose three-dot menu is open; null = none. */
  menuVehicleId: string | null;
  /** Typed form values keyed by input name (survive re-renders). */
  formValues: Record<string, string>;
}

const state: VehicleViewState = { modal: null, menuVehicleId: null, formValues: {} };

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
    bindFloatingFields(container);
    alignFabBar();
  };
  draw();
  return store.subscribe(draw);
}

/* --- Layout --- */

function vehicleViewHtml(): string {
  const dataset = store.get();
  const vehicles = dataset.vehicles;
  const body =
    vehicles.length === 0
      ? emptyStateHtml()
      : `<div class="vehicle-list">${vehicles.map((v) => vehicleRowHtml(v, dataset.settings.defaultVehicleId)).join("")}</div>`;
  return `
    <div class="view-stack view-stack--fab">
      <h1 class="view-title">${t("view.vehicle.title")}</h1>
      ${body}
      <div class="fab-bar">
        <button type="button" class="btn btn--filled js-add-vehicle">
          <span data-lucide="plus"></span>
          ${t("vehicle.addVehicle")}
        </button>
      </div>
      ${modalHtml()}
    </div>
  `;
}

function emptyStateHtml(): string {
  return `
    <section class="card vehicles-empty">
      <span class="vehicles-empty__icon" data-lucide="car-front"></span>
      <p class="vehicles-empty__text">${t("vehicle.noVehicles")}</p>
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
  const menuOpen = state.menuVehicleId === vehicle.id;

  return `
    <section class="card vehicle-row${isDefault ? " vehicle-row--default" : ""}">
      <div class="vehicle-row__main">
        <span class="vehicle-row__icon" data-lucide="car"></span>
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

/** Dropdown popover + full-screen click-away backdrop for the three-dot menu.
 * The default toggle is contextual: انتخاب به عنوان پیشفرض on non-default
 * cars, برداشتن از پیشفرض on the current default (there is always at most
 * one default vehicle). */
function cardMenuPopoverHtml(vehicleId: string, isDefault: boolean): string {
  return `
    <div class="card-menu__backdrop js-menu-backdrop"></div>
    <div class="card-menu__popover" role="menu" aria-label="${t("vehicle.menuLabel")}">
      <button type="button" class="card-menu__item js-menu-edit" role="menuitem" data-id="${escHtml(vehicleId)}">
        <span data-lucide="pencil"></span>
        ${t("vehicle.edit")}
      </button>
      <button type="button" class="card-menu__item js-menu-default" role="menuitem" data-id="${escHtml(vehicleId)}">
        <span data-lucide="star"></span>
        ${isDefault ? t("vehicle.removeDefault") : t("vehicle.makeDefault")}
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
    return `<div class="modal-overlay">${vehicleFormModalHtml(vehicle)}</div>`;
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

function vehicleFormModalHtml(vehicle: Vehicle | null): string {
  const editing = vehicle != null;
  const field = (name: string, get: () => string | null): string =>
    formValue(name, editing && vehicle ? get() ?? "" : "");

  return `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${editing ? t("vehicle.editTitle") : t("vehicle.setupTitle")}">
      <form id="vehicle-modal-form" class="form" novalidate>
        <div class="form__title">${editing ? t("vehicle.editTitle") : t("vehicle.setupTitle")}</div>
        <div class="field">
          <label class="field__label" for="vehicle-name">${t("vehicle.name")}</label>
          <input class="field__input" id="vehicle-name" name="name" type="text"
            value="${escHtml(field("name", () => vehicle?.name ?? null))}"
            placeholder="${t("vehicle.namePlaceholder")}" />
          <p class="field__error" id="vehicle-error-name" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="vehicle-year">${t("vehicle.year")}</label>
          <input class="field__input" id="vehicle-year" name="year" type="number"
            inputmode="numeric" min="1300" max="2100" step="1"
            value="${escHtml(field("year", () => (vehicle?.year != null ? String(vehicle.year) : null)))}" />
          <p class="field__error" id="vehicle-error-year" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="vehicle-average">${t("vehicle.averageDaily")}</label>
          <input class="field__input" id="vehicle-average" name="averageDaily" type="number"
            inputmode="decimal" min="0" step="any"
            value="${escHtml(field("averageDaily", () => (vehicle?.averageDailyDistance != null ? String(vehicle.averageDailyDistance) : null)))}" />
          <p class="field__hint">${t("vehicle.averageHint")}</p>
          <p class="field__error" id="vehicle-error-average" hidden></p>
        </div>
        <div class="field">
          <label class="field__label" for="vehicle-mileage">${t("vehicle.mileageLabel")}</label>
          <input class="field__input" id="vehicle-mileage" name="mileage" type="number"
            inputmode="numeric" min="0" step="1"
            value="${escHtml(field("mileage", () => (vehicle?.currentOdometer != null ? String(vehicle.currentOdometer) : null)))}" />
          <p class="field__hint">${t("vehicle.mileageHint")}</p>
          <p class="field__error" id="vehicle-error-mileage" hidden></p>
        </div>
        ${!editing ? `
        <div class="field vehicle-default-field">
          <label class="toggle-row">
            <span class="toggle-row__label">${t("vehicle.makeDefault")}</span>
            <span class="toggle">
              <input type="checkbox" name="makeDefault" value="1" role="switch" aria-label="${t("vehicle.makeDefault")}" />
              <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span>
            </span>
          </label>
          <p class="field__hint">${t("vehicle.makeDefaultHint")}</p>
        </div>` : ""}
        <div class="form__actions vehicle-modal-actions">
          <button type="button" class="btn btn--text js-cancel-modal">${t("common.cancel")}</button>
          <button type="submit" class="btn btn--filled">${editing ? t("vehicle.saveChanges") : t("vehicle.saveVehicle")}</button>
        </div>
      </form>
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
  container.querySelector<HTMLButtonElement>(".js-confirm-delete-vehicle")?.addEventListener("click", () => {
    const modal = state.modal;
    if (modal?.kind !== "delete") return;
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
      state.modal = { kind: "edit", vehicleId: button.dataset.id ?? "" };
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
      const id = button.dataset.id ?? "";
      state.menuVehicleId = null;
      store.update((draft) => {
        // Toggle: a default car can be removed, a regular car becomes default.
        draft.settings.defaultVehicleId = draft.settings.defaultVehicleId === id ? null : id;
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
  const yearRaw = String(data.get("year") ?? "").trim();
  const averageRaw = String(data.get("averageDaily") ?? "").trim();
  const mileageRaw = String(data.get("mileage") ?? "").trim();

  const year = yearRaw === "" ? null : Number(toLatinDigits(yearRaw));
  const average = averageRaw === "" ? null : Number(toLatinDigits(averageRaw));
  // Initial/current mileage: optional — empty keeps it unknown (null).
  const mileage = mileageRaw === "" ? null : Number(toLatinDigits(mileageRaw));

  const errors = validateVehicle({
    name,
    make: "",
    model: "",
    year,
    fuelType: null,
    averageDailyDistance: average,
  });
  const mileageErrors = mileage != null ? validateMileage(mileage) : [];
  if (errors.length > 0 || mileageErrors.length > 0) {
    showFieldErrors(container, [
      ...errors.map((error): [string, string] => [VEHICLE_ERROR_FIELD[error], t(ERROR_KEYS[error])]),
      ...mileageErrors.map((error): [string, string] => ["vehicle-error-mileage", t(ERROR_KEYS[error])]),
    ]);
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
      vehicle.year = year;
      vehicle.averageDailyDistance = average;
      vehicle.updatedAt = now;
      // Only treat the mileage as a new reading when it actually changed.
      if (mileage != null && mileage !== vehicle.currentOdometer) {
        vehicle.currentOdometer = mileage;
        vehicle.odometerUpdatedAt = now;
      }
    });
    return;
  }

  // Add — brand-new vehicle with the entered initial mileage. The optional
  // «انتخاب به عنوان پیشفرض» toggle promotes the new car to the default used
  // by the Services page (off by default).
  const makeDefault = data.get("makeDefault") === "1";
  const vehicleId = createId();
  state.modal = null;
  state.formValues = {};
  store.update((draft) => {
    draft.vehicles.push({
      id: vehicleId,
      name,
      make: "",
      model: "",
      year,
      fuelType: null,
      averageDailyDistance: average,
      currentOdometer: mileage,
      odometerUpdatedAt: mileage != null ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    if (makeDefault) {
      draft.settings.defaultVehicleId = vehicleId;
    }
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
  bindFloatingFields(container);
  alignFabBar();
}
