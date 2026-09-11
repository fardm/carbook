import type { CatalogEntry } from "./types";
import { t } from "../i18n";

export const CATALOG: readonly CatalogEntry[] = [
  // --- Engine ---
  {
    id: "engineOil",
    category: "engine",
    icon: "oil",
    suggestedKm: 10000,
    kmRange: [8000, 12000],
  },
  {
    id: "oilFilter",
    category: "engine",
    icon: "car-filter",
    suggestedKm: 10000,
    kmRange: [8000, 12000],
  },
  {
    id: "sparkPlugs",
    category: "engine",
    icon: "spark-plug",
    suggestedKm: 40000,
    kmRange: [30000, 60000],
  },
  {
    id: "alternatorBelt",
    category: "engine",
    icon: "timing-belt",
    suggestedKm: 80000,
    kmRange: [60000, 100000],
  },
  {
    id: "acBelt",
    category: "engine",
    icon: "timing-belt",
    suggestedKm: 80000,
    kmRange: [60000, 100000],
  },
  {
    id: "timingChain",
    category: "engine",
    icon: "timing-belt",
    suggestedKm: 150000,
    kmRange: [120000, 180000],
  },
  // --- Fluids ---
  {
    id: "coolant",
    category: "fluids",
    icon: "snowflake",
    suggestedKm: 40000,
    kmRange: [30000, 50000],
  },
  {
    id: "brakeFluid",
    category: "fluids",
    icon: "oil",
    suggestedKm: 40000,
    kmRange: [30000, 50000],
  },
  {
    id: "transmissionFluid",
    category: "fluids",
    icon: "oil",
    suggestedKm: 60000,
    kmRange: [40000, 80000],
  },
  {
    id: "powerSteeringFluid",
    category: "fluids",
    icon: "oil-red",
    suggestedKm: 40000,
    kmRange: [30000, 60000],
  },
  // --- Brakes ---
  {
    id: "brakePads",
    category: "brakes",
    icon: "brake-pads",
    suggestedKm: 10000,
    kmRange: [5000, 15000],
  },

  // --- Tires & Wheels ---
  {
    id: "tires",
    category: "tiresWheels",
    icon: "tire",
    suggestedKm: 40000,
    kmRange: [30000, 50000],
  },
  {
    id: "wheelBalancing",
    category: "tiresWheels",
    icon: "wheel-balancing",
    suggestedKm: 10000,
    kmRange: [8000, 15000],
  },

  // --- Electrical ---
  {
    id: "battery",
    category: "electrical",
    icon: "battery",
    suggestedKm: 60000,
    kmRange: [40000, 80000],
  },
  // --- Filters ---
  {
    id: "airFilter",
    category: "filters",
    icon: "car-filter",
    suggestedKm: 20000,
    kmRange: [15000, 30000],
  },
  {
    id: "cabinFilter",
    category: "filters",
    icon: "car-filter",
    suggestedKm: 15000,
    kmRange: [10000, 20000],
  },
  {
    id: "fuelFilter",
    category: "filters",
    icon: "car-filter",
    suggestedKm: 40000,
    kmRange: [30000, 60000],
  },

  {
    id: "radiator",
    category: "filters",
    icon: "radiator",
    suggestedKm: 50000,
    kmRange: [40000, 60000],
  },

  // --- HVAC ---
  {
    id: "cooler",
    category: "other",
    icon: "air-conditioner",
    suggestedKm: 40000,
    kmRange: [30000, 50000],
  },
  {
    id: "heater",
    category: "other",
    icon: "air-conditioner",
    suggestedKm: 40000,
    kmRange: [30000, 50000],
  },

  // --- Transmission ---
  {
    id: "clutchDisc",
    category: "other",
    icon: "clutch-disc",
    suggestedKm: 150000,
    kmRange: [120000, 180000],
  },
  {
    id: "exhaust",
    category: "other",
    icon: "exhaust",
    suggestedKm: 150000,
    kmRange: [120000, 180000],
  }
];

const entryById = new Map<string, CatalogEntry>(CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(id: string): CatalogEntry | null {
  return entryById.get(id) ?? null;
}

/** Returns the localized service name for a catalog service ID. */
export function serviceName(serviceId: string): string {
  return t(`catalog.${serviceId}` as any);
}