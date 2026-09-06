import { remindersCreateParamsFromHash } from "../ui/router";
import { calculateMaintenance } from "../domain/maintenance/calculations";
import { contextForVehicle } from "../domain/maintenance";
import { lastServiceFor } from "../domain/baselines";
import { bindDateFields, dateFieldHtml } from "../ui/date-field";
import { createId } from "../domain/ids";
import { t } from "../i18n";
import { store } from "../state/store";
import { escHtml } from "../ui/escape";
import { applyIcons } from "../ui/icons";
import { faNum } from "../ui/format";
import type { Dataset, Reminder } from "../domain/types";
import { bindFloatingFields } from "../ui/floating-field";
import type { ViewRenderer } from "./index";
import { checkReminder } from "../domain/reminders";
import { formatDate } from "../domain/calendar";

/** View state for the Reminders page. */
interface RemindersViewState {
  selectedVehicleId: string | null;
  filter: "all" | "upcoming" | "due" | "disabled";
  isFormOpen: boolean;
  editingReminderId: string | null;
  formDraft: Partial<Reminder> | null;
}

const state: RemindersViewState = {
  selectedVehicleId: null,
  filter: "all",
  isFormOpen: false,
  editingReminderId: null,
  formDraft: null,
};

export const renderReminders: ViewRenderer = (container: HTMLElement) => {
  const dataset = store.get();

  // check for query string intent
  const intent = remindersCreateParamsFromHash(window.location.hash);
  if (intent && intent.vehicleId) {
     state.selectedVehicleId = intent.vehicleId;

     // Build a form draft from the service
     const service = dataset.maintenanceItems.find(m => m.id === intent.serviceId);
     if (service && service.vehicleId === state.selectedVehicleId) {
         state.isFormOpen = true;
         state.editingReminderId = null;

         const vehicle = dataset.vehicles.find(v => v.id === state.selectedVehicleId);
         const context = contextForVehicle(dataset, state.selectedVehicleId!);
         const lastService = lastServiceFor(dataset.serviceHistory, service.id);
         const calc = calculateMaintenance(service, context, lastService?.date);

         let rType: "both" | "date" | "mileage" = "both";
         if (service.rule.intervalKm && !service.rule.intervalMonths) rType = "mileage";
         else if (!service.rule.intervalKm && service.rule.intervalMonths) rType = "date";
         else if (!service.rule.intervalKm && !service.rule.intervalMonths) rType = "date"; // fallback

         state.formDraft = {
            title: service.name,
            description: "",
            type: rType,
            serviceId: service.id,
            dueDate: calc.estimatedDueDate || null,
            dueMileage: (lastService?.odometer ?? vehicle?.currentOdometer ?? 0) + (service.rule.intervalKm || 0),
            repeat: "none",
            repeatKm: service.rule.intervalKm,
            notificationOffsets: [{ daysBefore: 7, kmBefore: 1000 }],
            active: true
         };

         // Clear the intent from URL without triggering hashchange reload loop
         history.replaceState(null, "", "#/reminders");
     }
  }

  // Resolve selected vehicle
  if (
    !state.selectedVehicleId ||
    !dataset.vehicles.some((v) => v.id === state.selectedVehicleId)
  ) {
    state.selectedVehicleId = dataset.settings.defaultVehicleId;
    if (
      !state.selectedVehicleId ||
      !dataset.vehicles.some((v) => v.id === state.selectedVehicleId)
    ) {
      state.selectedVehicleId = dataset.vehicles[0]?.id ?? null;
    }
  }

  redraw(container);

  return store.subscribe(() => {
    // If the currently selected vehicle is deleted, reset it
    const ds = store.get();
    if (state.selectedVehicleId && !ds.vehicles.some((v) => v.id === state.selectedVehicleId)) {
        state.selectedVehicleId = ds.vehicles[0]?.id ?? null;
    }
    redraw(container);
  });
};

function redraw(container: HTMLElement): void {
  const dataset = store.get();
  container.innerHTML = remindersViewHtml(dataset);
  bind(container);
  applyIcons();
  bindFloatingFields(container);
}

function formHtml(dataset: Dataset): string {
  const isEdit = state.editingReminderId !== null;
  let draft = state.formDraft;

  if (!draft) {
    if (isEdit) {
      const existing = dataset.reminders.find(r => r.id === state.editingReminderId);
      if (existing) {
         draft = { ...existing };
      }
    } else {
       draft = {
         title: "",
         description: "",
         type: "both",
         dueDate: null,
         dueMileage: null,
         repeat: "none",
         repeatKm: null,
         notificationOffsets: [{ daysBefore: 7, kmBefore: 1000 }],
         active: true
       };
    }
    state.formDraft = draft;
  }

  const d = draft!;

  return `
    <div class="modal">
      <div class="modal__surface">
         <header class="modal__header">
            <h2 class="modal__title">${isEdit ? t("reminders.editTitle" as any) : t("reminders.addTitle" as any)}</h2>
            <button type="button" class="btn btn--icon js-close-form" aria-label="${t("common.cancel" as any)}">
              <span data-lucide="x"></span>
            </button>
         </header>
         <div class="modal__content">
            <form class="form" id="reminder-form">
               <div class="field field--floating">
                  <input class="field__input" id="r-title" type="text" value="${escHtml(d.title || "")}" required />
                  <label class="field__label" for="r-title">${t("reminders.titleLabel" as any)}</label>
               </div>
               <div class="field field--floating">
                  <input class="field__input" id="r-desc" type="text" value="${escHtml(d.description || "")}" />
                  <label class="field__label" for="r-desc">${t("reminders.descriptionLabel" as any)}</label>
               </div>

               <fieldset class="field" style="margin-top: 1rem; border:1px solid var(--outline); padding:1rem; border-radius:4px;">
                  <legend>${t("reminders.typeLabel" as any)}</legend>
                  <div class="segmented" role="radiogroup">
                     <button type="button" class="segmented__option js-rtype ${d.type==='both'?'segmented__option--active':''}" data-val="both">${t("reminders.typeBoth" as any)}</button>
                     <button type="button" class="segmented__option js-rtype ${d.type==='date'?'segmented__option--active':''}" data-val="date">${t("reminders.typeDate" as any)}</button>
                     <button type="button" class="segmented__option js-rtype ${d.type==='mileage'?'segmented__option--active':''}" data-val="mileage">${t("reminders.typeMileage" as any)}</button>
                  </div>
               </fieldset>

               ${(d.type === "both" || d.type === "date") ? `
                 <div style="margin-top: 1rem;">
                    ${dateFieldHtml({ fieldId: "r-date-input", name: "dueDate", label: t("reminders.dueDateLabel" as any), value: d.dueDate || "" })}
                 </div>
               ` : ""}

               ${(d.type === "both" || d.type === "mileage") ? `
                 <div class="field field--floating" style="margin-top: 1rem;">
                    <input class="field__input" id="r-km" type="number" inputmode="numeric" min="0" step="1" value="${d.dueMileage != null ? escHtml(String(d.dueMileage)) : ""}" required />
                    <label class="field__label" for="r-km">${t("reminders.dueMileageLabel" as any)}</label>
                 </div>
               ` : ""}

               <div class="field" style="margin-top: 1rem;">
                  <label class="field__label" for="r-repeat">${t("reminders.repeatLabel" as any)}</label>
                  <select class="field__input" id="r-repeat">
                     <option value="none" ${d.repeat==="none"?"selected":""}>${t("reminders.repeatNone" as any)}</option>
                     <option value="yearly" ${d.repeat==="yearly"?"selected":""}>${t("reminders.repeatYearly" as any)}</option>
                     <option value="monthly" ${d.repeat==="monthly"?"selected":""}>${t("reminders.repeatMonthly" as any)}</option>
                     <option value="km" ${d.repeat==="km"?"selected":""}>${t("reminders.repeatKm" as any)}</option>
                  </select>
               </div>

               ${d.repeat === "km" ? `
                 <div class="field field--floating" style="margin-top: 1rem;">
                    <input class="field__input" id="r-repeat-km" type="number" inputmode="numeric" min="0" step="1" value="${d.repeatKm != null ? escHtml(String(d.repeatKm)) : ""}" required />
                    <label class="field__label" for="r-repeat-km">${t("reminders.repeatKmLabel" as any)}</label>
                 </div>
               ` : ""}

               <div style="margin-top:1rem; display:flex; align-items:center;">
                  <input type="checkbox" id="r-active" ${d.active ? "checked" : ""} style="margin-left: 0.5rem;" />
                  <label for="r-active">${t("reminders.activeLabel" as any)}</label>
               </div>

               <p class="field__error" id="form-error" hidden></p>
            </form>
         </div>
         <footer class="modal__footer">
            ${isEdit ? `<button type="button" class="btn btn--text status--danger js-delete-reminder">${t("reminders.delete" as any)}</button>` : `<div></div>`}
            <div>
              <button type="button" class="btn btn--text js-close-form">${t("common.cancel" as any)}</button>
              <button type="button" class="btn btn--filled js-save-form">${t("reminders.save" as any)}</button>
            </div>
         </footer>
      </div>
    </div>
  `;
}

function remindersViewHtml(dataset: Dataset): string {
  if (state.isFormOpen) {
     return formHtml(dataset);
  }

  if (dataset.vehicles.length === 0) {
    return `
      <div class="empty-state">
        <span class="empty-state__icon" data-lucide="car-front"></span>
        <p class="empty-state__text">${t("reminders.noVehicles" as any)}</p>
        <a class="btn btn--filled empty-state__action" href="#/vehicle">
          ${t("services.goToVehicles" as any)}
        </a>
      </div>
    `;
  }

  const vehicleOptions = dataset.vehicles
    .map(
      (v) => `
      <option value="${escHtml(v.id)}" ${v.id === state.selectedVehicleId ? "selected" : ""}>
        ${escHtml(v.name)} ${v.currentOdometer != null ? `(${faNum(v.currentOdometer)} ${t("vehicle.currentMileage" as any)})` : ""}
      </option>`,
    )
    .join("");

  return `
    <header class="page-header">
      <div class="field field--floating vehicle-select-field">
        <select class="field__input js-vehicle-select" id="reminders-vehicle-select" aria-label="${t("services.vehicleLabel" as any)}">
          ${vehicleOptions}
        </select>
        <label class="field__label" for="reminders-vehicle-select">${t("services.vehicleLabel" as any)}</label>
      </div>
    </header>
    <div class="reminders-content">
      ${filtersHtml()}
      ${remindersListHtml(dataset)}
    </div>

    <div class="fab-container">
      <button type="button" class="fab js-add-reminder" aria-label="${t("reminders.addTitle" as any)}">
        <span data-lucide="plus"></span>
        <span class="fab__label">${t("reminders.addTitle" as any)}</span>
      </button>
    </div>
  `;
}

function filtersHtml(): string {
  const options = [
    { value: "all", label: t("reminders.filterAll" as any) },
    { value: "upcoming", label: t("reminders.filterUpcoming" as any) },
    { value: "due", label: t("reminders.filterDue" as any) },
    { value: "disabled", label: t("reminders.filterDisabled" as any) }
  ];
  const buttons = options.map(opt => `
    <button type="button" class="segmented__option js-filter-option ${state.filter === opt.value ? 'segmented__option--active' : ''}"
      data-filter="${opt.value}" role="radio" aria-checked="${state.filter === opt.value}">
      ${opt.label}
    </button>
  `).join("");
  return `<div class="segmented" role="radiogroup" aria-label="Filters" style="margin-bottom: 1rem;">${buttons}</div>`;
}

function remindersListHtml(dataset: Dataset): string {
  const vehicle = dataset.vehicles.find(v => v.id === state.selectedVehicleId);
  let reminders = dataset.reminders.filter(r => r.vehicleId === state.selectedVehicleId);

  if (reminders.length === 0) {
    return `
      <div class="empty-state">
        <span class="empty-state__icon" data-lucide="bell"></span>
        <p class="empty-state__text">${t("reminders.noReminders" as any)}</p>
      </div>
    `;
  }

  // Filter based on state and status
  const rendered = reminders.map(r => {
    const status = checkReminder(r, vehicle);
    return { reminder: r, status };
  }).filter(item => {
    if (state.filter === "all") return true;
    if (state.filter === "disabled") return !item.reminder.active;
    if (state.filter === "upcoming") return item.reminder.active && item.status.status !== "due" && item.status.status !== "overdue";
    if (state.filter === "due") return item.reminder.active && (item.status.status === "due" || item.status.status === "overdue");
    return true;
  });

  if (rendered.length === 0) {
     return `<div class="empty-state"><p class="empty-state__text">موردی یافت نشد.</p></div>`; // Use existing generic or add
  }

  return rendered.map(item => reminderCardHtml(item.reminder, item.status.status, item.status.messages, dataset)).join("");
}

function reminderCardHtml(reminder: Reminder, status: string, messages: string[], dataset: Dataset): string {
  // basic card structure
  const statusIcon = status === "overdue" ? "triangle-alert" : status === "due" ? "calendar-clock" : status === "dueSoon" ? "clock" : "calendar-arrow-up";
  const iconColorClass = status === "overdue" ? "status--danger" : status === "due" ? "status--warn" : "status--ok";
  const serviceName = reminder.serviceId ? dataset.maintenanceItems.find(m => m.id === reminder.serviceId)?.name : null;

  return `
    <article class="card reminder-card js-edit-reminder" data-id="${reminder.id}" role="button" tabindex="0">
      <div class="reminder-card__header" style="display: flex; align-items: center; justify-content: space-between;">
         <h3 class="card__title" style="margin:0;">${escHtml(reminder.title)}</h3>
         ${!reminder.active ? `<span class="badge" style="background:var(--surface-variant);color:var(--on-surface-variant)">${t("reminders.inactiveLabel" as any)}</span>` :
            `<span data-lucide="${statusIcon}" class="${iconColorClass}" style="width:20px;height:20px;"></span>`}
      </div>
      ${serviceName ? `<p class="card__text" style="font-size:0.875rem; color:var(--on-surface-variant)">${t("reminders.linkedService" as any)} ${escHtml(serviceName)}</p>` : ""}
      <div style="margin-top:0.5rem;">
         ${reminder.dueDate ? `<div><span data-lucide="calendar" style="width:16px;height:16px;vertical-align:-3px;"></span> ${formatDate(reminder.dueDate, dataset.settings.calendar)}</div>` : ""}
         ${reminder.dueMileage !== null ? `<div><span data-lucide="gauge" style="width:16px;height:16px;vertical-align:-3px;"></span> ${faNum(reminder.dueMileage)} ${t("vehicle.currentMileage" as any)}</div>` : ""}
      </div>
      ${reminder.active && messages.length > 0 ? `<div style="margin-top:0.5rem; font-size:0.875rem; color:var(--primary)">${escHtml(messages.join("، "))}</div>` : ""}
    </article>
  `;
}

function saveInputsToDraft(container: HTMLElement) {
   if (!state.formDraft) return;
   const d = state.formDraft;
   const title = container.querySelector<HTMLInputElement>("#r-title");
   if (title) d.title = title.value;
   const desc = container.querySelector<HTMLInputElement>("#r-desc");
   if (desc) d.description = desc.value;
   const date = container.querySelector<HTMLInputElement>("input[name='dueDate']");
   if (date) d.dueDate = date.value;
   const km = container.querySelector<HTMLInputElement>("#r-km");
   if (km) d.dueMileage = km.value ? parseInt(km.value, 10) : null;
   const repeatKm = container.querySelector<HTMLInputElement>("#r-repeat-km");
   if (repeatKm) d.repeatKm = repeatKm.value ? parseInt(repeatKm.value, 10) : null;
   const active = container.querySelector<HTMLInputElement>("#r-active");
   if (active) d.active = active.checked;
}

function bind(container: HTMLElement): void {
  if (state.isFormOpen) {
    bindDateFields(container);

    container.querySelectorAll<HTMLButtonElement>(".js-rtype").forEach(btn => {
       btn.addEventListener("click", () => {
          if (state.formDraft) {
             state.formDraft.type = btn.dataset.val as any;
             // Preserve inputs before re-render
             saveInputsToDraft(container);
             redraw(container);
          }
       });
    });

    container.querySelector<HTMLSelectElement>("#r-repeat")?.addEventListener("change", (e) => {
       if (state.formDraft) {
          state.formDraft.repeat = (e.target as HTMLSelectElement).value as any;
          saveInputsToDraft(container);
          redraw(container);
       }
    });

    container.querySelectorAll<HTMLButtonElement>(".js-close-form").forEach(btn => {
       btn.addEventListener("click", () => {
          state.isFormOpen = false;
          redraw(container);
       });
    });

    container.querySelector<HTMLButtonElement>(".js-delete-reminder")?.addEventListener("click", () => {
       if (confirm(t("reminders.deleteConfirm" as any))) {
          if (state.editingReminderId) {
             store.update(ds => {
                ds.reminders = ds.reminders.filter(r => r.id !== state.editingReminderId);
             });
          }
          state.isFormOpen = false;
          redraw(container);
       }
    });

    container.querySelector<HTMLButtonElement>(".js-save-form")?.addEventListener("click", () => {
       saveInputsToDraft(container);
       const d = state.formDraft!;
       const err = container.querySelector("#form-error") as HTMLElement;

       if (!d.title?.trim()) {
          err.textContent = t("reminders.errorTitleRequired" as any);
          err.hidden = false;
          return;
       }
       if ((d.type === "date" || d.type === "both") && !d.dueDate) {
          err.textContent = t("reminders.errorDateRequired" as any);
          err.hidden = false;
          return;
       }
       if ((d.type === "mileage" || d.type === "both") && (d.dueMileage == null || isNaN(d.dueMileage))) {
          err.textContent = t("reminders.errorMileageRequired" as any);
          err.hidden = false;
          return;
       }
       if (d.repeat === "km" && (d.repeatKm == null || isNaN(d.repeatKm) || d.repeatKm <= 0)) {
          err.textContent = t("reminders.errorInvalidRepeatKm" as any);
          err.hidden = false;
          return;
       }

       const now = new Date().toISOString();

       store.update(ds => {
          if (state.editingReminderId) {
             const idx = ds.reminders.findIndex(r => r.id === state.editingReminderId);
             if (idx >= 0) {
                ds.reminders[idx] = {
                   ...ds.reminders[idx],
                   title: d.title!,
                   description: d.description || "",
                   type: d.type!,
                   dueDate: d.dueDate || null,
                   dueMileage: d.dueMileage ?? null,
                   repeat: d.repeat!,
                   repeatKm: d.repeatKm ?? null,
                   active: d.active!,
                   updatedAt: now
                };
             }
          } else {
             ds.reminders.push({
                id: createId(),
                vehicleId: state.selectedVehicleId!,
                serviceId: d.serviceId || null,
                title: d.title!,
                description: d.description || "",
                type: d.type!,
                dueDate: d.dueDate || null,
                dueMileage: d.dueMileage ?? null,
                notificationOffsets: d.notificationOffsets || [{daysBefore:7, kmBefore:1000}],
                repeat: d.repeat!,
                repeatKm: d.repeatKm ?? null,
                active: d.active!,
                lastNotifiedAt: null,
                createdAt: now,
                updatedAt: now
             });
          }
       });

       state.isFormOpen = false;
       redraw(container);
    });

    return;
  }
  container.querySelector<HTMLSelectElement>(".js-vehicle-select")?.addEventListener("change", (e) => {
    state.selectedVehicleId = (e.target as HTMLSelectElement).value;
    redraw(container);
  });

  container.querySelectorAll<HTMLButtonElement>(".js-filter-option").forEach(btn => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter as any;
      redraw(container);
    });
  });

  container.querySelector<HTMLButtonElement>(".js-add-reminder")?.addEventListener("click", () => {
    state.isFormOpen = true;
    state.editingReminderId = null;
    state.formDraft = null;
    redraw(container);
  });

  container.querySelectorAll<HTMLElement>(".js-edit-reminder").forEach(el => {
    el.addEventListener("click", () => {
      state.isFormOpen = true;
      state.editingReminderId = el.dataset.id ?? null;
      state.formDraft = null;
      redraw(container);
    });
  });
}
