import type { CatalogEntry } from "./types";

/**
 * Predefined maintenance catalog (§12, §20).
 *
 * Intervals follow sensible general maintenance guidance and are labeled as
 * recommendations in the UI (§13): they vary by vehicle, engine, fluids,
 * manufacturer guidance, and driving conditions. Users always customize.
 */

export const CATALOG: readonly CatalogEntry[] = [
  // --- Engine ---
  {
    id: "engineOil",
    category: "engine",
    icon: "droplets",
    name: { fa: "روغن موتور", en: "Engine Oil" },
    suggestedKm: 10000,
    kmRange: [8000, 12000],
    suggestedMonths: 6,
    monthsRange: [6, 12],
  },
  {
    id: "oilFilter",
    category: "engine",
    icon: "filter",
    name: { fa: "فیلتر روغن", en: "Oil Filter" },
    suggestedKm: 10000,
    kmRange: [8000, 12000],
    suggestedMonths: 6,
    monthsRange: [6, 12],
  },
  {
    id: "sparkPlugs",
    category: "engine",
    icon: "zap",
    name: { fa: "شمع", en: "Spark Plugs" },
    suggestedKm: 40000,
    kmRange: [30000, 60000],
    suggestedMonths: null,
    monthsRange: null,
  },
  {
    id: "alternatorBelt",
    category: "engine",
    icon: "infinity",
    name: { fa: "تسمه دینام", en: "Alternator Belt" },
    suggestedKm: 80000,
    kmRange: [60000, 100000],
    suggestedMonths: 60,
    monthsRange: [48, 72],
  },
  {
    id: "acBelt",
    category: "engine",
    icon: "infinity",
    name: { fa: "تسمه کولر", en: "AC Belt" },
    suggestedKm: 80000,
    kmRange: [60000, 100000],
    suggestedMonths: 60,
    monthsRange: [48, 72],
  },
  {
    id: "timingChain",
    category: "engine",
    icon: "link",
    name: { fa: "زنجیر تایم", en: "Timing Chain" },
    suggestedKm: null,
    kmRange: null,
    suggestedMonths: 120,
    monthsRange: [96, 144],
  },
  // --- Fluids ---
  {
    id: "coolant",
    category: "fluids",
    icon: "snowflake",
    name: { fa: "ضدیخ", en: "Coolant" },
    suggestedKm: 40000,
    kmRange: [30000, 50000],
    suggestedMonths: 24,
    monthsRange: [24, 36],
  },
  {
    id: "brakeFluid",
    category: "fluids",
    icon: "droplet",
    name: { fa: "روغن ترمز", en: "Brake Fluid" },
    suggestedKm: null,
    kmRange: null,
    suggestedMonths: 24,
    monthsRange: [24, 36],
  },
  {
    id: "transmissionFluid",
    category: "fluids",
    icon: "refresh-cw",
    name: { fa: "روغن گیربکس", en: "Transmission Fluid" },
    suggestedKm: 60000,
    kmRange: [40000, 80000],
    suggestedMonths: null,
    monthsRange: null,
  },
  {
    id: "powerSteeringFluid",
    category: "fluids",
    icon: "compass",
    name: { fa: "روغن فرمان", en: "Power Steering Fluid" },
    suggestedKm: 40000,
    kmRange: [30000, 60000],
    suggestedMonths: null,
    monthsRange: null,
  },
  {
    id: "washerFluid",
    category: "fluids",
    icon: "spray-can",
    name: { fa: "مایع شیشه‌شوی", en: "Windshield Washer Fluid" },
    suggestedKm: null,
    kmRange: null,
    suggestedMonths: 3,
    monthsRange: [2, 6],
  },

  // --- Brakes ---
  {
    id: "brakePads",
    category: "brakes",
    icon: "disc",
    name: { fa: "لنت ترمز", en: "Brake Pads" },
    suggestedKm: 10000,
    kmRange: [5000, 15000],
    suggestedMonths: 6,
    monthsRange: [6, 12],
  },
  {
    id: "brakeDiscs",
    category: "brakes",
    icon: "circle-dot",
    name: { fa: "دیسک ترمز", en: "Brake Discs" },
    suggestedKm: 30000,
    kmRange: [20000, 50000],
    suggestedMonths: 12,
    monthsRange: [12, 24],
  },

  // --- Tires & Wheels ---
  {
    id: "tires",
    category: "tiresWheels",
    icon: "circle",
    name: { fa: "لاستیک", en: "Tires" },
    suggestedKm: null,
    kmRange: null,
    suggestedMonths: 60,
    monthsRange: [48, 72],
  },
  {
    id: "wheelBalancing",
    category: "tiresWheels",
    icon: "target",
    name: { fa: "بالانس چرخ", en: "Wheel Balancing" },
    suggestedKm: 10000,
    kmRange: [8000, 15000],
    suggestedMonths: null,
    monthsRange: null,
  },

  // --- Electrical ---
  {
    id: "battery",
    category: "electrical",
    icon: "battery",
    name: { fa: "باتری", en: "Battery" },
    suggestedKm: null,
    kmRange: null,
    suggestedMonths: 48,
    monthsRange: [36, 60],
  },
  // --- Filters ---
  {
    id: "airFilter",
    category: "filters",
    icon: "wind",
    name: { fa: "فیلتر هوا", en: "Engine Air Filter" },
    suggestedKm: 20000,
    kmRange: [15000, 30000],
    suggestedMonths: 12,
    monthsRange: [12, 24],
  },
  {
    id: "cabinFilter",
    category: "filters",
    icon: "filter",
    name: { fa: "فیلتر کابین", en: "Cabin Filter" },
    suggestedKm: 15000,
    kmRange: [10000, 20000],
    suggestedMonths: 12,
    monthsRange: [12, 24],
  },
  {
    id: "fuelFilter",
    category: "filters",
    icon: "fuel",
    name: { fa: "صافی/فیلتر سوخت", en: "Fuel Filter" },
    suggestedKm: 40000,
    kmRange: [30000, 60000],
    suggestedMonths: null,
    monthsRange: null,
  },
];

const entryById = new Map(CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(id: string): CatalogEntry | null {
  return entryById.get(id) ?? null;
}