/**
 * Recommended component lifespans (kilometers) by catalog service id.
 *
 * Edit this file to change the general recommendations shown in the
 * Add/Edit Service form. Values are guidance only — never hard requirements.
 * Keys must match `CATALOG` entry ids in `catalog.ts`.
 */

export const RECOMMENDED_LIFESPAN_KM: Readonly<Record<string, number>> = {
  // Engine
  engineOil: 10000,
  oilFilter: 10000,
  sparkPlugs: 40000,
  timingBelt: 80000,
  timingChain: 150000,
  pcvValve: 60000,

  // Fluids
  coolant: 40000,
  brakeFluid: 40000,
  transmissionFluid: 60000,
  powerSteeringFluid: 40000,
  washerFluid: 10000,

  // Brakes
  brakePadsFront: 10000,
  brakePadsRear: 10000,
  brakeDiscsFront: 30000,
  brakeDiscsRear: 30000,

  // Tires & wheels
  tires: 40000,
  wheelAlignment: 10000,
  wheelBalancing: 10000,

  // Electrical
  battery: 60000,
  headlights: 40000,
  brakeLights: 40000,
  turnSignals: 40000,

  // Filters
  airFilter: 20000,
  cabinFilter: 15000,
  fuelFilter: 40000,
};

/** Recommended lifespan in km for a catalog service, or null when unknown. */
export function recommendedLifespanKm(catalogId: string | null | undefined): number | null {
  if (catalogId == null || catalogId === "") return null;
  const km = RECOMMENDED_LIFESPAN_KM[catalogId];
  return km == null ? null : km;
}
