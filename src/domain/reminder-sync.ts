import { calculateMaintenance, contextForVehicle } from "./maintenance/calculations";
import type { Dataset, MaintenanceItem, Reminder } from "./types";

/**
 * Service-synchronized reminders.
 *
 * A reminder with `syncWithService: true` was created from its service's
 * detail page. The SERVICE is the source of truth: its due date/mileage are
 * NOT independent copies — they resolve live from the service's
 * next-recommended schedule (last service + interval, the same calculation
 * the service detail page shows). When the user records the service again,
 * the next recommended values move and the reminder follows automatically —
 * no sync pass, no drift, no duplicated derived data.
 *
 * Manual reminders (syncWithService false — including every pre-v12 row)
 * are never touched: their stored values stay exactly as the user set them.
 */

/**
 * The next-recommended date/mileage of a maintenance item (the values the
 * service detail page shows). Null on either side the service cannot
 * provide (no interval configured, or no service history baseline yet).
 */
export function recommendedDueForService(
  item: MaintenanceItem,
  dataset: Dataset,
): { dueDate: string | null; dueMileage: number | null } {
  const context = contextForVehicle(dataset, item.vehicleId);
  const calc = calculateMaintenance(item, context);
  return { dueDate: calc.nextDueDate, dueMileage: calc.nextDueOdometer };
}

/**
 * Effective reminder: for service-synchronized reminders the TITLE mirrors
 * the service's current name and the due date/mileage come from the
 * service (restricted to the conditions the reminder's type watches).
 * Manual reminders pass through unchanged. When the linked service no
 * longer exists, the stored values fall back — deleting a service must
 * never make a reminder crash or vanish.
 */
export function resolveReminder(reminder: Reminder, dataset: Dataset): Reminder {
  if (!reminder.syncWithService || reminder.serviceId == null) return reminder;
  const item = dataset.maintenanceItems.find((candidate) => candidate.id === reminder.serviceId);
  if (!item) return reminder;
  const recommended = recommendedDueForService(item, dataset);
  const watchesDate = reminder.type === "date" || reminder.type === "date_mileage";
  const watchesKm = reminder.type === "mileage" || reminder.type === "date_mileage";
  return {
    ...reminder,
    title: item.name,
    dueDate: watchesDate ? recommended.dueDate : null,
    dueMileage: watchesKm ? recommended.dueMileage : null,
  };
}

/** Resolves a whole list of reminders in one pass. */
export function resolveReminders(reminders: readonly Reminder[], dataset: Dataset): Reminder[] {
  return reminders.map((reminder) => resolveReminder(reminder, dataset));
}
