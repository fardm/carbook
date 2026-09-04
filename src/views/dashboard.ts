import { lastInspectionFor } from "../domain/baselines";
import { calculateMaintenance, type MaintenanceCalculation } from "../domain/maintenance";
import { getCurrentOdometer } from "../domain/odometer";
import type { MaintenanceItem, Vehicle } from "../domain/types";
import { t } from "../i18n";
import { store } from "../state/store";
import { escHtml } from "../ui/escape";
import { faNum } from "../ui/format";
import { applyIcons, STATUS_ICONS } from "../ui/icons";
import { maintenanceDetailHash } from "../ui/router";
import {
  compareByUrgency,
  primaryMetricText,
  resolvePrimaryMetric,
  statusLabel,
  summaryBucket,
} from "../ui/maintenance-display";

/**
 * Dashboard (§30): vehicle summary, maintenance summary counts, and the most
 * urgent maintenance items. Everything derives from the engine — no
 * duplicated calculations.
 */
export function renderDashboard(container: HTMLElement): () => void {
  const draw = (): void => {
    container.innerHTML = dashboardHtml();
    applyIcons();
  };
  draw();
  return store.subscribe(draw);
}

function dashboardHtml(): string {
  const dataset = store.get();
  const vehicle = dataset.vehicle;
  const odometer = getCurrentOdometer(dataset);

  const activeItems = dataset.maintenanceItems.filter((item) => item.active);
  const calcs = activeItems.map((item) => ({
    item,
    calc: calculateMaintenance(item, dataset),
  }));

  const vehicleCard = vehicle
    ? `
      <section class="card vehicle-summary">
        <span class="vehicle-summary__icon" data-lucide="car-front"></span>
        <div class="vehicle-summary__info">
          <div class="vehicle-summary__name">${escHtml(vehicle.name)}</div>
          ${vehicleMeta(vehicle) ? `<div class="vehicle-summary__meta">${escHtml(vehicleMeta(vehicle))}</div>` : ""}
          <div class="vehicle-summary__odometer">
            ${odometer ? `${faNum(odometer.odometer)} ${t("common.kmUnit")}` : t("vehicle.notRecorded")}
          </div>
        </div>
        <a class="btn btn--text" href="#/vehicle">${t("dashboard.updateOdometer")}</a>
      </section>
    `
    : `
      <section class="card vehicle-summary vehicle-summary--empty">
        <p class="vehicle-summary__empty-text">${t("dashboard.noVehicle")}</p>
        <a class="btn btn--filled" href="#/vehicle">${t("dashboard.setupVehicle")}</a>
      </section>
    `;

  const summaryCard =
    calcs.length === 0
      ? `
        <section class="card">
          <h2 class="card__title">${t("dashboard.maintenanceTitle")}</h2>
          <p class="empty-note">${t("dashboard.noItems")} <a href="#/maintenance">${t("dashboard.viewAll")}</a></p>
        </section>
      `
      : `
        <section class="card">
          <h2 class="card__title">${t("dashboard.maintenanceTitle")}</h2>
          <div class="summary-chips">
            ${summaryChip("overdue", calcs)}
            ${summaryChip("dueSoon", calcs)}
            ${summaryChip("ok", calcs)}
          </div>
        </section>
      `;

  const priorityCard =
    calcs.length === 0
      ? ""
      : `
        <section class="card">
          <div class="card__head">
            <h2 class="card__title">${t("dashboard.priorityTitle")}</h2>
            <a class="btn btn--text" href="#/maintenance">${t("dashboard.viewAll")}</a>
          </div>
          <ul class="item-list">
            ${[...calcs]
              .sort((a, b) =>
                compareByUrgency(
                  { status: a.calc.status, remainingPercent: a.calc.remainingPercent },
                  { status: b.calc.status, remainingPercent: b.calc.remainingPercent },
                ),
              )
              .slice(0, 5)
              .map(({ item, calc }) => priorityRowHtml(item, calc))
              .join("")}
          </ul>
        </section>
      `;

  return `
    <div class="view-stack">
      ${vehicleCard}
      ${summaryCard}
      ${priorityCard}
    </div>
  `;
}

function summaryChip(
  bucket: "overdue" | "dueSoon" | "ok",
  calcs: { calc: ReturnType<typeof calculateMaintenance> }[],
): string {
  const count = calcs.filter(({ calc }) => summaryBucket(calc.status) === bucket).length;
  return `
    <span class="summary-chip summary-chip--${bucket}">
      <span class="summary-chip__count">${faNum(count)}</span>
      <span class="summary-chip__label">${t(`status.${bucket === "ok" ? "ok" : bucket === "dueSoon" ? "dueSoon" : "overdue"}` as never)}</span>
    </span>
  `;
}

function priorityRowHtml(item: MaintenanceItem, calc: MaintenanceCalculation): string {
  const kind = resolvePrimaryMetric(calc, item.rule.displayMode);
  let primary = primaryMetricText(calc, kind);
  if (!primary && item.rule.inspectionBased) {
    const lastInspection = lastInspectionFor(store.get().inspectionHistory, item.id);
    primary =
      lastInspection?.condition != null
        ? `${t("maintenance.list.conditionLabel")}: ${t(`maintenance.condition.${lastInspection.condition}` as never)}`
        : null;
  }
  return `
    <li class="item-list__row">
      <a class="item-list__main" href="${maintenanceDetailHash(item.id)}">
        <span class="item-list__icon" data-lucide="${item.icon}"></span>
        <div class="item-list__info">
          <div class="item-list__head">
            <span class="item-list__name">${escHtml(item.name)}</span>
            <span class="status-chip status-chip--${calc.status}">
              <span data-lucide="${STATUS_ICONS[calc.status]}"></span>
              ${statusLabel(calc.status)}
            </span>
          </div>
          ${primary ? `<div class="metric metric--primary">${primary}</div>` : ""}
        </div>
      </a>
    </li>
  `;
}

/** "make — model — year" or an empty string when nothing is set. */
function vehicleMeta(vehicle: Vehicle): string {
  return [vehicle.make, vehicle.model, vehicle.year != null ? String(vehicle.year) : ""]
    .filter((part) => part !== "")
    .join(" — ");
}