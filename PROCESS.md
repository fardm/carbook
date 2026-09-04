# Car Maintenance Tracker — Process / Implementation State

> This document records the real implementation state, decisions, issues, and
> next steps. It is the handoff document for continuing agents.

---

## Current State

**Phases 1–13: COMPLETE** ✅ (Foundation, Data & Persistence, Calculation
Engine, Vehicle & Odometer, Maintenance Catalog, Add/Edit Maintenance,
Dashboard & Maintenance List, Maintenance Detail & History, Google Calendar,
Import/Export, PWA/Offline, UX & Responsive Polish, Final QA)
**Project status: stable and ready for personal daily use** — the Phase 13
final-QA pass is complete (see below). The project is feature-complete per
PROJECT_PLAN; remaining ideas (سوابق aggregate log, etc.) are optional
follow-ups, not planned phases.

The application is a vanilla TypeScript + Vite PWA with a working RTL Persian
app shell, hash-based navigation, a versioned persistence layer, a fully
tested calculation engine, and real UI for the vehicle/odometer (Phase 4),
the catalog + custom items (Phase 5), the add/edit configuration flow
(Phase 6), the live maintenance list + dashboard (Phase 7), the complete
item detail page with record/edit/lifecycle flows (Phase 8), and — new in
Phase 9 — a manual "افزودن به تقویم گوگل" action on the detail page that
builds an event-creation URL (§38: name + due/estimated date + description,
no OAuth/API — the app remains the source of truth), and — new in Phase
10 — full §41–§43 backup/restore: the تنظیمات view exports the whole
dataset as a stamped, pretty-printed JSON file and imports with FULL
structural validation → preview → explicit overwrite confirmation via the
existing atomic `store.replace`, and — new in Phase 11 — a fully
installable offline PWA: a fa/rtl web app manifest, raster icons generated
dependency-free from the favicon art (`npm run gen:icons`), and a
cache-first service worker that precaches the whole shell (document, hashed
JS/CSS, fonts, icons), and — new in Phase 12 — UX & Responsive Polish: a
manual light/dark/system theme (persisted on the Settings schema — v2
migration — applied via `data-theme` + a pre-paint anti-flash script), the
duplicate-activation notice (decision 29), and a half-typed item form that
no longer wipes itself on unrelated re-renders (decision 31). Phases 7–12
"Done when" are all met: the complete maintenance lifecycle works (Add →
Track → Update odometer → Service → Reset → Preserve history), a user can
send a maintenance date to Google Calendar without authentication, a
complete dataset round-trips through export → import with no data loss
(§49), the application boots and runs entirely from cache with the origin
server stopped (§44), and the app feels like a polished utility rather than
a prototype (Phase 12 “Done when”).

Git note: all of the work below is **uncommitted** (the repo only has the
initial "first commit" with the plan documents). Nothing has been staged or
committed.

---

## Phase Status Overview

| Phase | Status |
|---|---|
| 1 — Project Foundation | ✅ Completed |
| 2 — Data Model & Persistence | ✅ Completed |
| 3 — Maintenance Calculation Engine | ✅ Completed |
| 4 — Vehicle & Odometer | ✅ Completed |
| 5 — Maintenance Catalog | ✅ Completed |
| 6 — Add/Edit Maintenance | ✅ Completed |
| 7 — Dashboard | ✅ Completed |
| 8 — Maintenance Detail & History | ✅ Completed |
| 9 — Google Calendar | ✅ Completed |
| 10 — Import/Export | ✅ Completed |
| 11 — PWA / Offline | ✅ Completed |
| 12 — UX & Responsive Polish | ✅ Completed |
| 13 — Final QA | ✅ Completed |

---

## Phase 1 — What Was Implemented

### Project scaffold
- `package.json` — scripts: `dev`, `build` (`tsc --noEmit && vite build`),
  `preview`, `typecheck`, `test` (`vitest run`).
- `tsconfig.json` — strict, `noEmit`, `moduleResolution: bundler`,
  `verbatimModuleSyntax`, `noUnusedLocals/Parameters`.
- `vite.config.ts` — `base: "./"` (relative asset URLs so the built app works
  from any GitHub Pages sub-path without config), inline empty PostCSS config,
  Vitest config (node env, `tests/**/*.test.ts`).
- `.gitignore` — `node_modules`, `dist`, etc.
- `index.html` — `<html lang="fa" dir="rtl">`, app shell (app bar, content
  main, nav), theme-color meta, SVG favicon (`public/icon.svg`).

### Design system (M3-inspired)
- `src/styles/tokens.css` — full M3-style color roles for light + dark
  (`@media (prefers-color-scheme: dark)`), status colors (ok / upcoming /
  due-soon / due / overdue) for later calculation phases, type scale, shape,
  subdued elevation, 4px spacing scale, motion tokens. Palette seeded from a
  calm teal-green.
- `src/styles/fonts.css` — self-hosted **Vazirmatn** (400/500/600/700 woff2 in
  `public/fonts/`, ~200 KB total, SIL OFL, downloaded from the official
  GitHub repo via jsDelivr).
- `src/styles/base.css` — reset, typography, `:focus-visible`, reduced-motion.
  Everything uses logical properties so RTL is structural, not bolted on.
- `src/styles/layout.css` — app shell: sticky app bar; **mobile** = bottom
  navigation bar; **desktop (≥900px)** = nav rail on the inline-start side
  (right in RTL) with centered readable content column.
- `src/styles/components.css` — base buttons (filled/text), icon button, card,
  placeholder-view styles. More components are added in later phases.

### i18n
- `src/i18n/fa.ts` — Persian catalog with language-independent keys
  (`nav.dashboard`, `view.dashboard.title`, …). Structure defines the
  `Messages` type.
- `src/i18n/index.ts` — type-safe `t(key)` with dot-path `MessageKey` type;
  throws on unknown keys. `Locale = "fa"` (only enabled language in MVP).
- `fa.ts` is the source of truth for keys; tests walk it to guarantee every
  leaf resolves.

### Routing & navigation
- `src/ui/router.ts` — hash router (`#/dashboard`, `#/maintenance`,
  `#/history`, `#/vehicle`, `#/settings`), pure `parseHash()` with fallback to
  the dashboard route. Works on any static host (GitHub Pages) with zero
  server config.
- `src/ui/placeholder.ts` — shared Phase 1 placeholder view renderer.
- `src/views/*.ts` + `src/views/index.ts` — one module per view, registry maps
  route id → render function. Each view is a placeholder that describes the
  feature coming in its phase.
- `src/main.ts` — bootstraps styles, app title, nav (rendered from the routes
  table + i18n), and re-renders the active view on `hashchange`, maintaining
  `aria-current="page"` and refreshing Lucide icons after each render.

### Icons
- **Lucide** (vanilla package, v1.40.0) wired through `createIcons` with a
  small PascalCase registry. `data-lucide="kebab-name"` attributes are
  resolved to PascalCase keys by lucide itself (verified against the installed
  package source).

### Tests (toolchain smoke tests)
- `tests/i18n.test.ts` — every catalog leaf is a non-empty string; every key
  resolves via `t()`; unknown keys throw.
- `tests/router.test.ts` — hash parsing for all routes, default fallback,
  round-trip via `hashFor`, unique ids/hashes.

---

## Phase 2 — What Was Implemented

### Domain model (`src/domain/`)
- `types.ts` — full typed schema per PROJECT_PLAN §9–§18, §39:
  - `Vehicle` (no persisted `currentOdometer` — derived, see decisions),
  - `OdometerReading` (§10),
  - `MaintenanceItem` with `MaintenanceRule` (§14–§16): independent
    `intervalKm` / `intervalMonths` criteria + `trigger` ("any" — first
    criterion reached, §15/§25), `displayMode` (§26), `inspectionBased`
    flag (§16/§28), `catalogId` for catalog templates (Phase 5), `active`
    for deactivation (§14),
  - `ServiceRecord` (§17: id, maintenanceItemId, date, odometer, notes,
    cost; brand/partNumber/quantity deliberately deferred — §17 says add
    them only if they provide value and no phase plans UI for them),
  - `InspectionRecord` with `InspectionCondition` (good / watch /
    replaceSoon / replaceNow, §36),
  - `StatusThresholds` + `Settings` (§29; applied by the Phase 3 engine),
  - `Dataset` versioned envelope (§39).
- `defaults.ts` — `CURRENT_VERSION = 1`, `defaultSettings()` (dueSoon 20%,
  due 5% — provisional until Phase 3), `defaultDataset()`.
- `ids.ts` — `createId()` via `crypto.randomUUID` with fallback.
- `odometer.ts` — `getCurrentOdometer()` (latest reading by date/createdAt,
  §10) + `sortReadings()`/`compareByDate()` (lexicographic ISO compare).
- `maintenance.ts` — `lastServiceFor()` / `lastInspectionFor()` — baselines
  derived from history, not stored (see decisions).

### Persistence (`src/persistence/repository.ts`)
- Single storage key `car-maintenance-tracker.dataset` (§39).
- Injectable `StorageBackend` (browser localStorage; in-memory fallback
  outside the browser).
- `createRepository()`: `load()` / `save()` / `clear()`.
- Defensive `loadFromString()`: invalid JSON / non-object / missing
  version / future version → logged warning + default dataset (never crash).
- Migration seam: `migrations` table walked version-by-version to
  `CURRENT_VERSION`, then `normalize()` repairs shape (missing arrays,
  partial settings merged with defaults). `migrations[0]` is an identity
  placeholder proving the mechanism.
- `save()` always stamps the current version (§40).

### Store (`src/state/store.ts`)
- Minimal pub/sub `Store`: `get()`, `update(mutate)` (clone → mutate →
  persist → notify), `replace()` (for Phase 10 import), `reset()`, and
  `subscribe()` returning an unsubscribe fn.
- `export const store` singleton — safe to import anywhere because
  `browserStorage()` falls back to memory outside the browser.
- NOTE: the store is NOT yet imported by the UI (views are placeholders).
  Phase 3/4 should `import { store } from "./state/store"`.

---

## Phase 3 — What Was Implemented

### Calculation engine (`src/domain/maintenance/`)
- `dates.ts` — calendar helpers: `isoToDay` / `dayToIso` (UTC whole-day
  arithmetic, timezone/DST-proof), `todayIso()` (user-local), `addMonths`
  (calendar-aware, day-clamped: 2026-01-31 + 1mo = 2026-02-28; leap-year
  aware).
- `rules.ts` — `nextDueOdometer` (lastServiceOdometer + intervalKm, §22),
  `nextDueDate` (lastServiceDate + intervalMonths, §23),
  `totalIntervalDays` (exact calendar days in the time interval).
- `calculations.ts` — the central engine (§21): `calculateMaintenance(item,
  ctx, today)` returns a `MaintenanceCalculation` result (status, remainingKm,
  remainingDays, estimatedKmDays, estimatedDueDate, remainingPercent,
  primaryCriterion, nextDueOdometer, nextDueDate, totalIntervalDays,
  lastService facts for the §33 explanation). Building blocks exported for
  tests: `calculateRemainingKm`, `calculateRemainingDays`,
  `calculateEstimatedKmDays` (remainingKm ÷ averageDailyDistance, rounded UP,
  §11/§24), `calculateEstimatedDueDate` (§24, estimate only),
  `calculateRemainingPercentage` (clamped 0–100, §28), `determinePrimaryTrigger`
  (§25). `today` is an injectable parameter — deterministic tests.
- `status.ts` — `calculateMaintenanceStatus` (§29) using
  `settings.statusThresholds`. Statuses: `ok` / `upcoming` / `dueSoon` /
  `due` / `overdue` / `inspectionRequired` (language-independent ids; UI
  maps them to labels/icons later — never color alone).
- `index.ts` — barrel export.

### Refactor
- `src/domain/maintenance.ts` → **`src/domain/baselines.ts`** (last
  service/inspection helpers) so the new `maintenance/` engine directory does
  not collide with the file on case-insensitive filesystems. Signatures now
  take `readonly` arrays.
- `src/domain/odometer.ts` — `getCurrentOdometer` accepts readonly history.

### Status semantics (decision — see decisions list)
- Interval items: OVERDUE = past due; DUE ≤ duePercent (default 5%);
  DUE_SOON ≤ dueSoonPercent (default 20%); UPCOMING < 100%; OK ≥ 100%.
- Inspection items: no fabricated remaining life (§16/§28) —
  INSPECTION_REQUIRED when never inspected or the configured km/month
  inspection interval is exceeded; otherwise condition maps replaceNow →
  DUE, replaceSoon → DUE_SOON, watch → UPCOMING, good/null → OK.
- Percentage (§28) is computed against the PRIMARY criterion (km: remaining ÷
  intervalKm; time: remainingDays ÷ exact interval calendar days).

---

## Phase 4 — What Was Implemented

### Store wiring
- Views now return an optional **dispose function** from their render
  (`src/views/index.ts`); `main.ts` calls it before swapping views, so store
  subscriptions never leak across routes.
- `src/ui/icons.ts` — icon registry extracted from `main.ts`; views that
  re-render themselves call `applyIcons()` (the dashboard does).

### Vehicle view (`src/views/vehicle.ts`)
- **Setup / edit form**: name (required), make, model, year, fuelType,
  averageDailyDistance (§9, §11). Inline errors; Persian-digit input
  normalized via `toLatinDigits`. Save goes through `store.update` (creates
  or merges into the vehicle, stamps createdAt/updatedAt).
- **Current odometer** card — derived via `getCurrentOdometer` (§10).
- **Record odometer** form (date defaults to today, value in km): validates
  per §47 via the pure `validateOdometerEntry` (missing/invalid/future date,
  missing/invalid value), then appends a reading — never discarding history.
  Live non-blocking warnings: decrease and > 5,000 km jump.
- **History** list (newest first, Jalali dates via `formatDate`), with an
  **edit** action per row = historical correction (§47): updates date/value
  in place (id/createdAt preserved); the derived current odometer updates
  automatically.
- No deletion of readings — §10 says never discard previous readings;
  corrections are done by editing.

### Dashboard vehicle summary card (`src/views/dashboard.ts`)
- Vehicle name, "make — model — year", current odometer (Persian digits),
  "ثبت کیلومتر" action linking to the vehicle view (§30). Empty state: CTA
  to register the vehicle. Subscribes to the store (re-renders live).
- The maintenance summary/priority list remains a Phase 7 placeholder (scope
  discipline: Phase 4 owns vehicle data only).

### Domain / UI helpers
- `src/domain/odometer.ts` — added `validateOdometerEntry`, `OdometerError`,
  warning kinds, `LARGE_INCREASE_KM = 5000`, `isIsoDate` (strict).
- `src/domain/vehicle.ts` — `VehicleInput` + `validateVehicle`.
- `src/ui/format.ts` — `faNum` (Intl fa-IR), `toLatinDigits` (Persian /
  Arabic-Indic normalization), `formatDate` (Jalali via Intl fa-IR, noon-
  anchored so timezones never shift the day).
- `src/ui/escape.ts` — `escHtml` for all user data interpolated into HTML.
- i18n: `common.*`, `vehicle.*` (~30 keys), `dashboard.*` keys added.

---

## Phase 5 — What Was Implemented

### Catalog (`src/catalog/`)
- `types.ts` — `CatalogEntry` (id, category, lucide icon, `{fa,en}` name,
  suggestedKm/suggestedMonths + kmRange/monthsRange, `inspectionBased`,
  optional `displayMode`) and `CatalogCategoryId` (§7, §12–§13, §20).
- `catalog.ts` — **27 predefined templates** across the six §12 categories
  (engine, fluids, brakes, tiresWheels, electrical, filters): engine oil
  (8–12k / suggested 10k + 6 mo), oil filter, spark plugs, timing belt,
  timing chain (inspection), PCV valve, coolant, brake fluid (24 mo),
  transmission/power-steering/washer fluids, front/rear pads & discs
  (inspection), tires (time + inspection per §20), alignment, balancing,
  battery, lights (inspection), air/cabin/fuel filters. Every icon verified
  against the installed lucide package.
- `categories.ts` — category metadata with localized names + `categoryName`
  (tolerant of unknown ids).
- All interval data are recommendations; the UI labels them as such (§13).

### Item factories (`src/domain/item-factory.ts`)
- `itemFromCatalog(entry, now)` — template → active `MaintenanceItem` with
  the suggested rule, `catalogId` set, name = localized snapshot (§14).
- `customItemFromInput(input, now)` — custom items with `catalogId: null`;
  identical MaintenanceItem shape → one calculation path (§37).
- `validateCustomItem` — name required; intervals positive integers; a
  tracking rule required (inspection or ≥1 interval).

### Maintenance view (`src/views/maintenance.ts`)
- **Active items list** (sorted by fa name) with a deactivate action
  (toggles `active: false`; data preserved for Phase 8 restore).
- **Catalog browser**: search box (matches fa/en name + category, focus kept
  across re-renders), entries grouped by category, each row shows
  `بازه پیشنهادی` range + `پیشنهاد` suggested line (Persian digits), with
  the §13 recommendation disclaimer under the search box. Inspection-based
  entries show `بازرسی دوره‌ای`.
- **Custom item form**: name, category select (localized), 12-icon picker
  (real lucide SVGs, selected state highlighted), km + months intervals,
  inspection checkbox, inline validation errors.
- View-local state (tab, search, chosen icon) survives store-driven
  re-renders; text inputs reset after a successful create (by design).

### Other
- `src/ui/icons.ts` — 31 registered lucide icons + `CUSTOM_ICON_CHOICES`.
- i18n: `maintenance.*` keys (~25); removed the now-unused
  `view.maintenance.description`.
- CSS: tabs, item lists, catalog groups, icon picker, checkbox field.

---

## Phase 6 — What Was Implemented

### Generalized factories (`src/domain/item-factory.ts`)
- `ItemDraft` — the editable configuration (name, category, icon, intervals,
  inspection toggle, displayMode §26); `buildItem(draft, {catalogId, now,
  id?})` — single build path for catalog/custom/edit; `validateItemDraft`
  (name, positive-integer intervals, tracking rule required).
- `itemFromCatalog` / `customItemFromInput` kept as thin wrappers (existing
  tests + API unchanged).
- **Initial-data validators**: `validateInitialService` (date required if
  odometer given; no future dates; odometer ≥ 0 integer) and
  `validateInitialInspection` (date required if condition given) — §19/§36.

### Unified configuration form (`src/views/maintenance.ts`)
- One `itemFormHtml(prefill, meta)` used by three entry points:
  - **catalog-add** — pre-filled from the template's recommended rule (§19:
    show recommended → accept or edit), with a back button to the browser;
  - **custom tab** — empty draft (catalogId null);
  - **edit** — pre-filled from an existing item (new ویرایش button on each
    active-list row), no initial-data section (baseline editing is Phase 8).
- Fields: name, category, icon picker, km + months intervals, inspection
  checkbox, **display preference segmented control** (auto/km/time/both,
  §26), optional initial service (date + odometer) OR initial inspection
  (date + condition) — the section swaps live with the inspection toggle.
- Saving (catalog/custom) creates the item AND, when initial data is
  provided, a `ServiceRecord`/`InspectionRecord` linked to it — the derived
  baseline works immediately with the Phase 3 engine. Editing updates
  rule/name/category/icon + updatedAt in place.
- Validation: draft errors + initial-data errors shown inline before any
  write; nothing is persisted on failure.
- Fixed decision-27 violation: local state (config) is now cleared BEFORE
  `store.update`, so the notify-driven re-render closes the form correctly.

### Other
- i18n: `maintenance.form.*`, `maintenance.display.*`, `maintenance.condition.*`,
  `maintenance.editItem`, `maintenance.editTitle` keys.
- CSS: segmented control, item-list actions.

---

## Phase 7 — What Was Implemented

### Display helpers (`src/ui/maintenance-display.ts`)
- **Presentation logic only** — no calculation duplication (§48): the engine
  returns everything; this module formats it.
- `primaryMetricText(calc, displayMode)` / `secondaryMetricText(...)` —
  implements Auto display mode (§27): actionable metric first (km or days,
  whichever the item's primary criterion is), the other as the secondary
  line; `displayMode: both` shows both; explicit km/time modes pin the
  primary. Overdue shows "X کیلومتر گذشته"; due-soon inspection items show
  the condition phrase instead of fabricated metrics (decision 21).
- `formatRemainingTime(days)` — days → "~N ماه" for large values
  (`> 62 days`), Persian-digit days below; `estimatedDueText` /
  `dueDateText` label estimates (§31) vs real due dates.
- `statusLabel(calc)`, `urgencyRank`, `compareByUrgency` (overdue < due <
  dueSoon = inspectionRequired < upcoming < ok, remaining percent as
  tiebreak, inspection items last within a tier), `summaryBucket`
  (§30: overdue → "overdue"; due/dueSoon/inspectionRequired → "dueSoon";
  upcoming/ok → "ok").

### Maintenance list (`src/views/maintenance.ts`)
- Every active-item row now shows: icon tile, name (+ سفارشی marker), a
  **status chip** (icon + label + color — never color alone, §29), primary
  metric line (km / time / condition per display mode), secondary metric,
  **estimated due date** (§31, labeled تخمین for km-driven estimates vs
  سررسید for real calendar dates), and a **progress bar** (percent, colored
  by status; inspection items have no bar — no fabricated life, decision
  21). ویرایش / غیرفعال کردن actions kept.
- **Sort toggle** (فوریت / نام): urgency order per §30 vs alphabetical;
  module state, survives re-renders.

### Dashboard (`src/views/dashboard.ts`)
- Kept the vehicle summary card (name, make—model—year, current odometer,
  ثبت کیلومتر action).
- **Maintenance summary** (§30): three chips — گذشته (overdue),
  به‌زودی (due + dueSoon + inspectionRequired), خوب (upcoming + ok) — with
  counts computed via `summaryBucket`.
- **Priority list** (§30): all items sorted by urgency, each row with icon,
  status chip, and the primary metric line; inspection items show the
  condition phrase (e.g. وضعیت: به‌زودی تعویض). مشاهده همه links to
  `#/maintenance`. Empty states (no vehicle / no items) stay clean.

### Other
- i18n: `status.*` labels + `maintenance.list.*` (sort labels, estimated /
  due prefixes, remaining-time phrases, condition fallback).
- Icons registered: `CircleCheck`, `CircleAlert`, `OctagonAlert` (aliases
  `CheckCircle`/`AlertCircle` also exist in this lucide build — registry
  uses the canonical names), `AlertTriangle`, `Info`.
- CSS: status chips (`.status-chip--*` per token), progress bars
  (`.progress--*` colored), summary chips (`.summary-chip--*`), metric
  lines; RTL-safe throughout.

---

## Phase 8 — What Was Implemented

### Domain (`src/domain/records.ts`, new)
- `validateServiceRecordEntry` / `validateInspectionRecordEntry` — pure,
  language-independent validators for §35/§36 events: date required /
  real / not-future (§47); odometer optional but non-negative integer when
  given; service cost optional non-negative number; inspection condition
  REQUIRED (see decision 41); measurement optional non-negative.
- `sortHistoryNewestFirst` — (date, createdAt) descending sort for history
  lists; input never mutated.

### Router (`src/ui/router.ts`)
- Detail hashes `#/maintenance/<itemId>` now parse to the **maintenance**
  route (nav keeps نگهداری highlighted) via a `MAINTENANCE_DETAIL_RE`;
  `maintenanceItemIdFromHash` extracts the id; `maintenanceDetailHash`
  builds links. No new nav entry; views map unchanged.

### Maintenance view (`src/views/maintenance.ts`) — detail-page MODE
- `maintenanceViewHtml` branches: config form → detail page (when the hash
  carries an item id) → list. The record-form state is scoped to its item
  id so stale module state after navigation can't open another item's form.
- **Detail page** (§32): back link; header card (icon, name, category,
  live status chip or غیرفعال badge) with action buttons — record
  service/inspection (inspection items get ثبت بازرسی, interval items
  ثبت سرویس), ویرایش (opens the existing config form; cancel returns to
  the detail), غیرفعال کردن / فعال‌سازی دوباره, حذف (inline confirm, only
  for deactivated items).
- **§33 calculation explanation** in the overview card: metric lines + a
  dl of facts — configured interval, last service / last inspection (Jalali
  date + km/condition), next service (due km + date), current odometer,
  average daily distance, the estimated-due-date basis, and the earlier
  trigger criterion for km-AND-time items. No duplicated math (decision
  36).
- **Record / edit forms** (§35–§36): inline cards with date (defaults to
  today), odometer (defaults to the current odometer, §35), and kind-
  specific fields — service: optional cost + notes; inspection: required
  condition select + optional measurement + notes. Edit mode (ویرایش per
  history row) pre-fills the record and saves in place (id/createdAt kept).
  Validation errors show inline; nothing persists on failure; state is
  cleared BEFORE the store update (decision 27) so the notify-driven
  re-render closes the form. Record service updates the history AND the
  baseline automatically (decision 10) — verified live.
- **History sections** (§34): service records and inspection records shown
  newest-first under their own cards, each with date, km, cost/condition/
  measurement, notes (escaped), and a ویرایش button. Records are never
  deleted (decision 22/§34). An interval item shows the service section;
  an inspection item the inspection section (the other appears only if
  records exist).
- **Lifecycle**: a نگهداری‌های غیرفعال section lists deactivated items
  with فعال‌سازی دوباره and حذف; delete uses an inline confirm
  (no `window.confirm`) and removes the item AND its service/inspection
  history, then navigates back to the list when needed.
- List rows (active + inactive) and dashboard priority rows are now links
  to the item's detail page (`item-list__main` anchor, actions kept as
  separate siblings).

### Other
- i18n: `maintenance.detail.*` (overview/history/actions/labels),
  `maintenance.record.*` (form titles, field labels, error messages),
  `maintenance.inactiveTitle`.
- CSS: `.item-list__main` (row link), `.status-chip--inactive`, `.btn--danger`,
  `.delete-confirm`, `.detail-*` (head/actions/confirm), `.history__note`
  (multi-line notes); RTL-safe.

---

## Phase 9 — What Was Implemented

### URL builder (`src/ui/calendar.ts`, new)
- Pure, unit-tested event-creation URL builder per §38 (manual only — no
  OAuth/API/sync/event ids; the app stays the source of truth).
- `googleCalendarUrl({ title, date, details?, allDay? })` →
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&
  dates=…&details=…`. All-day events (the default — a due date is a day,
  not a slot) span `date/date+1` because Google's range end is exclusive;
  `allDay:false` falls back to a 1-hour 09:00 slot.
- `text`/`details` are `encodeURIComponent`-encoded (Persian-safe) but the
  `dates` value keeps its literal `/` (URLSearchParams would emit `%2F`,
  which Google rejects). Helpers `isoToGoogleDate` (`yyyy-mm-dd` →
  `YYYYMMDD`) and `dayAfterIso` (UTC day arithmetic, leap-year-safe).

### Detail-page action (`src/views/maintenance.ts`)
- New "افزودن به تقویم گوگل" link in the actions row (§32/§38), rendered
  as `target="_blank" rel="noopener noreferrer"` with a `calendar-plus`
  icon. It appears only for ACTIVE items AND when a date is computable:
  `calc.estimatedDueDate ?? calc.nextDueDate` — the primary criterion's
  date (real when time anchors it, estimated for km-driven items; §31).
  Items with no baseline (never serviced / pure inspection items with no
  measurable rule) get no link — nothing to remind about (§36: never
  pretend a date exists).
- `calendarEventHref(item, calc)` composes title = item name and a
  two-line Persian description: last service date/odometer (interval
  items) and "یادآوری سرویس بعدی: <date>". All rendering stays in the
  view; the builder itself is UI-independent and tested.
- i18n: `maintenance.detail.addToCalendar`, `maintenance.detail.calendarEventNote`.
  Icon: `CalendarPlus` registered in `src/ui/icons.ts`.

---

## Phase 10 — What Was Implemented

### Strict import validator + export helpers (`src/persistence/import-export.ts`, new)
- `validateImportText(text)` — the Phase 2 deferral of decision 13, now
  fulfilled: parse → version gate (missing/non-number/fractional/future
  versions rejected) → migrate OLD versions through the SAME `migrateRaw`
  table as loading (extracted/exported from repository.ts so there is one
  migration path) → strict field-by-field validation against the current
  schema. Fail-closed: ANY issue returns `ok:false` with a JSON-path issue
  list (e.g. `maintenanceItems[0].rule.intervalKm`) and the UI never
  touches current data (§42). Checks: required top-level fields; exact
  types; enum membership (fuelType, displayMode, trigger, condition,
  thresholds 0–100 + duePercent ≤ dueSoonPercent); ranges (year 1900–2100,
  non-negative integers for odometer/measurements, positive intervals);
  ISO dates; non-empty strings; rule must track something (§16/§37);
  duplicate ids rejected per collection; service/inspection
  `maintenanceItemId` must reference an item present in the file (orphans
  would be silently invisible). Extra unknown top-level keys are tolerated
  (forward-compatible within a version).
- `buildExport` (stamps `exportedAt` + current version), `serializeExport`
  (pretty JSON), `backupFilename` (car-maintenance-backup-<date>.json).

### Settings view (`src/views/settings.ts`, rewritten)
- **Backup card** (§41/§43): §43 warning box (data lives only in this
  browser; JSON export is the only backup), a دانلود پشتیبان (JSON)
  button that stamps `exportedAt` into the live dataset and downloads the
  file via Blob + `<a download>`, and an «آخرین پشتیبان‌گیری» line (Jalali
  datetime via new `formatDateTime` in ui/format.ts) or «هنوز
  پشتیبان‌گیری نشده است».
- **Restore card** (§40 step 5–6, §42): hidden file input styled as an
  upload button → `validateImportText` → on failure an error box lists up
  to 15 issues («path» — دلیل) with «داده‌های فعلی دست‌نخورده باقی
  ماندند» + a «N مشکل دیگر» tail; on success a preview shows the file's
  exportedAt, vehicle name, and per-collection counts plus the §43
  overwrite warning with انصراف / جایگزینی داده‌های فعلی (danger). Confirm
  calls the existing atomic `store.replace` (state cleared BEFORE the
  write — decision 27) and shows a dismissible success box. Error and
  preview states are view-local module state; the picker re-renders and
  re-binds after each transition.- View subscribes to the store (last-export line + imported dataset stay
  live); Download/Upload icons registered; `.box--warn/error/success`,
  `.visually-hidden`, and settings-page CSS added.

---

## Phase 11 — What Was Implemented

### Web app manifest (`public/manifest.webmanifest`, new)
- fa/rtl, `standalone`, `start_url`/`scope` relative (`./`) so GitHub Pages
  sub-path hosting works, `theme_color #0f3d33` (light) / `#0e1513` (dark
  meta), `background_color #f4fbf7` (light surface), name «دفترچه نگهداری
  خودرو» / short_name «دفترچه خودرو», icons 192/512 any + 512 maskable.

### Raster icons (`scripts/gen-icons.mjs`, new — `npm run gen:icons`)
- The manifest needs PNG icons, but node has no SVG rasterizer and the
  project avoids dependencies — so the script REPLICATES the favicon art
  itself: a small SVG-path parser (M/L/H/V/C/A with absolute/relative
  forms + circle primitives) flattens the exact icon.svg paths into
  polylines, and each pixel's alpha comes from its distance to the stroke
  centreline (exact round caps/joins, ~1 px anti-aliasing), rounded-rect
  background via signed distance. PNGs are written by a ~30-line chunked
  encoder (zlib only). Output: public/icon-{180,192,512}.png — visually
  verified against the favicon.

### Service worker (`public/sw.js`, new)
- CACHE-FIRST for every same-origin GET with a fallback to the shell HTML
  for offline navigations; data is NEVER cached (localStorage is the
  source of truth — decision 53). On install it precaches the shell: it
  fetches index.html, discovers its hashed JS/CSS via `src`/`href`
  attributes, then parses the CSS `url(...)` references to precache the
  self-hosted fonts, plus icons/manifest. `CACHE` name
  (`car-maintenance-shell-v1`) is the release version — bump on deploy;
  the activate handler evicts older `car-maintenance-shell-*` caches.
  Scope-relative URLs (`./`) keep sub-path hosting working.

### Wiring
- `index.html`: manifest link, apple-touch-icon (icon-180.png), dark-mode
  theme-color meta, mobile-web-app-capable + apple metas.
- `src/main.ts`: `registerServiceWorker()` — only in production builds
  (`import.meta.env.PROD`, never the dev server), registered on `load`,
  failures only warn. `src/vite-env.d.ts` added for `vite/client` types.
- `package.json`: `gen:icons` script.

---

## Phase 12 — What Was Implemented

### Manual colour theme (light / dark / system) — schema v2
- **Data model**: new `ThemePreference` (`system | light | dark`) on
  `Settings`; `CURRENT_VERSION` 1 → 2 with migration step 1 (adds
  `theme: "system"` to stored settings — same single migration path used
  by loading AND strict import, so v1 backups import cleanly). Defensive
  `normalizeSettings` and the import validator both enforce the enum.
- **CSS**: tokens.css no longer switches on `prefers-color-scheme` — the
  dark palette lives under `:root[data-theme="dark"]` (set on `<html>`),
  so a manual choice works without duplicating a single value;
  `color-scheme` is now per-theme. A tiny pre-paint script in index.html
  (mirrors theme.ts — commented as such) sets `data-theme` before first
  paint to avoid a light flash for dark-OS users; theme.ts also keeps the
  `theme-color` meta in sync (#0f3d33 / #0e1513).
- **`src/ui/theme.ts`** (new): pure `resolveTheme(pref, systemDark)`,
  `applyTheme`, and `registerThemeSync()` (applies now + subscribes to the
  store so تنظیمات changes apply live; while “system” is selected a
  matchMedia listener re-applies on OS changes). Booted from main.ts.
- **Settings UI**: new ظاهر card (segmented radiogroup سیستم/روشن/تیره)
  persists via `store.update` → survives reload, export/import, and the
  service worker (localStorage unchanged). Live-verified light ↔ dark +
  reload persistence + a seeded v1 dataset migrating to v2 in place.

### Polish backlog
- **Duplicate-activation notice** (decision 29): opening a catalog item
  that is already ACTIVE shows a non-blocking «این مورد در نگهداری‌های
  فعال ثبت شده است: …» warning under the form title (box--warn); adding
  duplicates stays allowed.
- **Item form no longer wipes itself** (decision 31): typed text/date/
  select values live in `state.formValues` keyed by input name (captured
  on input/change, read back when drawing), so any re-render — an icon
  click, the inspection toggle, an unrelated store update — preserves the
  half-filled form. Values reset on cancel, on a successful save, and when
  a NEW form opens (no stale leakage into catalog prefill).
- **Dashboard “top few” cap confirmed**: the priority list already slices
  to 5 (removed the stale Known-Issues bullet claiming otherwise).

### Review + accessibility spot-checks
- Desktop/tablet layout re-read (nav rail ≥900 px, form grids, readable
  840 px column) — no changes needed; `.settings-theme` row got spacing.
- Audit findings: the catalog search already carried an `aria-label`;
  forms/labels/radiogroups/date inputs are labelled; focus-visible and
  reduced-motion were already global. No blocking issues found; the formal
  Lighthouse pass is Phase 13.

---

## Phase 13 — What Was Implemented

Final QA (verify-and-fix). Findings fixed during the pass:

- **SW cache bump v1 → v2** (`public/sw.js`): the Phase 12 shell changed
  (theme CSS), so `car-maintenance-shell-v2` replaces v1 on next install;
  the activate handler evicts the old cache (decision 54 — the constant is
  the release version).
- **Stale placeholder copy removed** (`src/i18n/fa.ts`): the
  `view.vehicle.description` key still described the vehicle view as a
  “future” placeholder; the vehicle view is fully implemented since Phase
  4, so the description was deleted (it is not rendered anywhere).

### What was verified (no code change needed)

- **§49 live calculation spot-checks**: seeded پژو ۲۰۷ (avg 40 km/day) +
  100,000 km odometer + five items (روغن موتور 10k km/6 mo serviced 3 mo
  ago @95,000; فیلتر کابین 15k/12 mo serviced @90,000; روغن ترمز 24 mo
  time-only serviced a year ago; لنت جلو inspection watch; تسمه دینام
  inspection, never inspected). Engine output matched hand-math exactly
  for all five: روغن موتور 5,000 km/91 d remaining, time-primary (est.
  125 d > 91 d), 50%, due 2026-12-04; فیلتر کابین km-primary (125 d <
  181 d), 33%, estimate 2027-01-07; روغن ترمز 365 d / 50% time-only due
  2027-09-04; inspection items carry no fabricated metrics (good / no
  fabricated life — decision 21). Dashboard summary counted ۰ گذشته / ۰
  به‌زودی / ۵ خوب (belt moved into خوب only after its first inspection
  was recorded) and the priority list order/rows matched the engine.
  Also probed the no-baseline interval-item edge: status `ok`/خوب, all
  remaining values null, no calendar link (nothing measurable — §31).
- **End-to-end re-test in the live app** (each prior phase had already
  covered its flows; this pass re-ran the full journey on one dataset):
  catalog+custom creation → live list chips/metrics/progress → item
  detail (§33 facts in Jalali) → record an inspection on the never-
  inspected belt (condition good → chip خوب, history + overview updated)
  → dashboard live re-count → vehicle odometer form: decrease warning
  (98,000 → “کاهش یافته (۲٬۰۰۰ کیلومتر)”), >5,000 km jump warning
  (106,000 → “افزایش قابل توجه (۶٬۰۰۰ کیلومتر)”), negative value
  rejected inline with history untouched, cancel closes the form →
  settings: theme تیره applies + persists across reload with no flash
  (data-theme + theme-color meta verified), restored to سیستم;
  backup/restore cards render complete.
- **RTL + keyboard pass**: `lang=fa dir=rtl` on the root and computed
  `direction: rtl` confirmed; focus landed on the first row link after
  navigation and the Tab order on a detail page was logical (back →
  actions → bottom nav); activation worked. All interactive controls are
  native (links/buttons/inputs/radiogroups) with labels and
  aria-selected/checked/pressed where needed.
- **Built-PWA structural audit** (`npm run build` + `vite preview` on
  4173): dist ships `sw.js` (`CACHE = "car-maintenance-shell-v2"`),
  `manifest.webmanifest` (name دفترچه نگهداری خودرو, lang fa, dir rtl,
  display standalone, start_url `./`, icons 192/512 any + 512 maskable
  all present), and the three icon PNGs; index.html references the
  manifest + apple-touch-icon, carries the pre-paint theme script and
  `theme-color`; the hashed JS/CSS in index.html exactly match the
  assets the SW will precache (the discovery-based precache needs no
  rebuild). The SW registration call ships in the built JS. (Offline
  serving itself was proven in Phase 11 — the same cache-first path.)
- **Code hygiene scan**: `grep` for TODO/FIXME/console.log/@ts-ignore/
  @ts-expect-error /any — clean; no leftover scaffolding. No new
  dependencies; nothing persisted is derived (store + engine invariants
  hold). The only remaining placeholder is the سوابق view (deliberate;
  listed as an optional follow-up).

---

## Tests Performed

Phase 1:
- `npm run typecheck` — clean (strict TS, TS 7.0.2 native compiler).
- `npm test` — 9 tests (i18n, router).
- `npm run build` — clean production build.
- Manual dev-server verification (RTL, fonts, icons, all 5 routes).

Phase 2:
- `npm run typecheck` — clean.
- `npm test` — 34 tests pass (5 files): persistence round-trip/versioning/
  corruption/migration, domain helpers, store behavior.
- `npm run build` — clean.

Phase 3 (all re-run together):
- `npm run typecheck` — clean.
- `npm test` — 65 tests pass (8 files), 31 new: dates, §49 calculation
  scenarios (distance/time/both/overdue/percentage/odometer/service-reset),
  status tiers + inspection lifecycle.
- `npm run build` — clean (engine not yet imported by UI at that point).

Phase 4 (all re-run together):
- `npm run typecheck` — clean; `npm test` — 83 tests pass (9 files);
  `npm run build` — clean.
- Manual dev-server verification: full vehicle → odometer → edit-correction
  flow, decrease warning, future-date rejection, dashboard card (details in
  the Phase 4 section of this file).

Phase 5 (all re-run together):
- `npm run typecheck` — clean; `npm test` — 96 tests pass (10 files);
  `npm run build` — clean.
- Manual dev-server verification: catalog browse/search/activate, custom
  creation, deactivate (details in the Phase 5 section of this file).

Phase 6 (all re-run together):
- `npm run typecheck` — clean.
- `npm test` — **114 tests pass (11 files)**, 18 new in
  `tests/item-form.test.ts`: draft validation (name/interval/rule),
  buildItem (custom id, catalogId, displayMode persisted, name trim),
  initial-service validation (optional empty, valid, date-without-odometer,
  odometer-without-date, future/malformed dates, negative/decimal
  odometers), initial-inspection validation (optional, condition-without-
  date, future date).
- `npm run build` — clean (JS 54.98 kB / gzip 15.30 kB).
- Manual dev-server verification (Preview tab):
  1. Catalog افزودن opens the config form pre-filled with the recommended
     rule (engine oil: 10,000 km / 6 mo, display auto, service section).
  2. Customizing (km → 12,000, display → کیلومتر) + initial service
     (2026-08-20 @ 103,900) saves the item AND a linked ServiceRecord; the
     view correctly returns to the browser (after the state-order fix).
  3. Edit flow: ویرایش opens the form pre-filled (customized 12,000 km
     preserved); renaming + changing to 15,000 km persists; the active list
     shows the new name.
  4. Inspection item (لنت جلو): checkbox pre-checked, initial INSPECTION
     section shown (not service), condition options present; saving creates
     the item + InspectionRecord (condition good).
  5. Validation: clearing both intervals + future service date → rule +
     future-date errors shown, nothing persisted (verified item count).
  6. Screenshot verified: inline errors in red, segmented display control,
     icon picker selection, RTL, active nav; console clean.

Phase 7 (all re-run together):
- `npm run typecheck` — clean; `npm test` — **131 tests pass (12 files)**,
  17 new in `tests/maintenance-display.test.ts`: primary/secondary metric
  text for every display mode × criterion kind, km-past + days-past
  overdue phrasing, time formatting (days/“~N ماه” boundary), status label
  mapping for all six statuses, urgency ordering + tiebreak (percent,
  inspection last), summary buckets (§30 grouping).
- `npm run build` — clean (JS 64.72 kB / gzip 17.94 kB).
- Manual dev-server verification (Preview tab) with seeded data (Peugeot
  207 @ 104,900 km + 5 items):
  1. Maintenance list: chips + metrics correct per item — فیلتر کابین
     گذشته ۹۰۰ km past (~−۲۲ روز, تخمین date), روغن موتور رسیده ۶ روز /
     ۳٪ + سررسید date, تسمه دینام به‌زودی ۵٬۱۰۰ km / ~۴ ماه + تخمین,
     لنت جلو (inspection) chip + condition line (no fabricated metrics),
     روغن ترمز در پیش ۱۷۸ روز / ۲۴٪ + سررسید; progress bars colored
     correctly (0 / 3 / 10 / 24).
  2. Sort toggle: فوریت order matches urgency; switched to نام order.
  3. Dashboard: vehicle card intact; summary chips ۱ گذشته / ۳ به‌زویی /
     ۱ خوب (correct bucket mapping of the 5 seeded items); priority list
     matches the list ordering; مشاهده همه navigates to نگهداری.
  4. Inspection row in the priority list initially lacked its condition
     line — fixed (row now reads its own calc's condition phrase);
     re-verified لنت جلو shows وضعیت: به‌زودی تعویض.
  5. Screenshot verified: chip colors (red/orange/amber/blue), summary
     chip palette, RTL, active nav; console clean throughout.
  6. Seeded demo data cleared afterwards (user starts fresh; empty states
     re-verified).

Phase 8 (all re-run together):
- `npm run typecheck` — clean; `npm test` — **145 tests pass (13 files)**, 14
  new: `tests/records.test.ts` (10) — service entry validation (valid,
  date-only, missing/malformed/future dates, negative/decimal odometers,
  negative/zero/decimal/null costs), inspection entry validation
  (condition required, date rules, odometer, measurement 8.2/0/−2), history
  sorting (date desc, createdAt tiebreak, no input mutation);
  `tests/router.test.ts` (4) — detail hash parses to the maintenance route,
  id extraction, non-detail hashes return null.
- `npm run build` — clean (JS 86.85 kB / gzip 21.35 kB — growth is the
  detail-page markup in the maintenance bundle).
- Manual dev-server verification (Preview tab) with seeded data:
  1. List rows are links → detail page opens for روغن موتور; header chip
     رسیده + §33 explanation (interval, last service ۱۹ اسفند ۱۴۰۴ @
     ۹۶٬۸۰۰ km, next service ۱۰۶٬۸۰۰ km · ۱۹ شهریور, current odometer,
     avg ۴۰ km/day, estimated date, earlier criterion زمان).
  2. Record service (ثبت سرویس): form pre-fills today + current odometer;
     saved with cost ۵۲۰٬۰۰۰ + note → status flipped رسیده → خوب, remaining
     ۶ days → ۱۸۱ days/100%, baseline reset (next service ۱۱۴٬۹۰۰ km), new
     record on top, old record preserved.
  3. Record EDIT (ویرایش on a history row): form opens pre-filled (title
     ویرایش سرویس), cost changed → persisted in place, count unchanged.
  4. Service validation: future date + negative odometer + negative cost
     → three inline errors, form stays open, nothing persisted.
  5. Inspection item (لنت جلو): detail shows condition + measurement;
     ثبت بازرسی without a condition → وضعیت بازرسی را انتخاب کنید error;
     with condition replaceSoon + measurement ۴٫۲ + note → saved, status
     در پیش → به‌زودی, new inspection on top.
  6. Lifecycle: غیرفعال کردن moved لنت جلو into the نگهداری‌های غیرفعال
     section; فعال‌سازی دوباره restored it (history intact); deactivated
     again → حذف shows inline confirm (این مورد و همه سوابق…) → confirm
     removed the item AND its inspection records and navigated back to the
     list.
  7. Dashboard priority row (روغن موتور) navigates to its detail page.
  8. Screenshot + console verified: detail layout, RTL, green خوب chip +
     active نگهداری nav; console clean. Seeded data cleared afterwards.

Phase 9 (all re-run together):
- `npm run typecheck` — clean; `npm test` — **151 tests pass (14 files)**, 6
  new in `tests/calendar.test.ts`: isoToGoogleDate conversion, dayAfterIso
  across month/year/leap boundaries, all-day URL with action=TEMPLATE +
  `dates=YYYYMMDD/YYYYMMDD+1` literal slash, Persian title/details round-trip
  through URL-encoding, details omitted when absent, timed-event variant.
- `npm run build` — clean (JS 88.34 kB / gzip 21.84 kB).
- Manual dev-server verification (Preview tab) with seeded data:
  1. Interval item (روغن موتور, time-anchored): calendar link present in
     the actions row between ویرایش and غیرفعال کردن; href decodes to
     `action=TEMPLATE`, `text=روغن موتور`, `dates=20260910/20260911`
     (due ۱۹ شهریور = 2026-09-10, +1 exclusive), Persian details with last
     service + یادآوری سرویس بعدی lines.
  2. Km-only item WITHOUT a service baseline: NO calendar link (no
     date/baseline exists — correct, §36-style restraint).
  3. Km-only item after adding a service record: link appears with the
     estimated date (`dates=20271223/20271224` from 19,000 km @ 40 km/day).
  4. Inspection item: no calendar link, but ثبت بازرسی action intact.
  5. Screenshot verified: calendar-plus icon + label render; console clean.
     Seeded data cleared afterwards.

Phase 10 (all re-run together):
- `npm run typecheck` — clean; `npm test` — **202 tests pass (15 files)**, 51
  new in `tests/import-export.test.ts`: export helpers (exportedAt/version
  stamping, parseable pretty JSON, filename), round trips (canonical export
  → identical dataset, empty default dataset, legacy version-0 via the
  shared migration table, extra unknown top-level key tolerated), root &
  version gate (invalid JSON, non-object roots, missing/string/fractional/
  negative/future versions), structure & types (missing top-level field,
  wrong-typed arrays/exportedAt, unparseable exportedAt), vehicle (missing/
  blank/wrong-typed name, out-of-range year, unknown fuelType, negative
  average, null vehicle), odometer (string/negative values, out-of-range
  and malformed dates, duplicate ids), items & rules (duplicate ids,
  missing rule, negative/fractional intervals, unknown displayMode/trigger,
  rule with no tracking criterion, non-boolean inspectionBased/active),
  service/inspection history (unknown references both kinds, duplicate
  service ids, negative/wrong-typed cost, unknown condition, negative
  measurement, null condition accepted), settings (missing thresholds,
  out-of-range percentages, duePercent > dueSoonPercent), multi-issue
  single-pass reporting, and atomicity (invalid file yields issues only,
  never a partial dataset).
- `npm run build` — clean (JS 103.04 kB / gzip 25.71 kB).
- Manual dev-server verification (Preview tab):
  1. Seeded a full dataset (پژو ۲۰۷ + روغن موتور item + service); the
     تنظیمات page renders the two cards with the §43 warning and «هنوز
     پشتیبان‌گیری نشده است».
  2. Export: clicking دانلود پشتیبان (JSON) stamped `exportedAt` into
     localStorage and the line updated to «آخرین پشتیبان‌گیری: ۱۳ شهریور
     ۱۴۰۵ ساعت ۱۵:۱۵» (Jalali datetime); console clean.
  3. Import preview: dispatched a DIFFERENT valid file
     (backup-samand.json: سمند + inspection item) via DataTransfer →
     preview shows the file name, its exportedAt (۸ شهریور…), vehicle سمند
     and counts ۱/۱/۰/۱ with the overwrite warning.
  4. Cancel: انصراف dismissed the preview; live data still پژو ۲۰۷ with
     exportedAt intact.
  5. Confirm: جایگزینی داده‌های فعلی atomically replaced the dataset —
     success box «داده‌ها با موفقیت بازیابی شد.» (dismissible), the
     backup card now shows the IMPORTED file's exportedAt, localStorage
     holds the سمند dataset, and the dashboard/vehicle views reflect it
     (۸۵٬۰۰۰ km, لنت ترمز جلو, وضعیت: خوب).
  6. Invalid file (`{"version":1}`): error box lists all seven
     missingField issues with paths; «داده‌های فعلی دست‌نخورده باقی
     ماندند»; live data unchanged. Future-version file: single
     «نسخهٔ فایل از نسخهٔ پشتیبانی‌شدهٔ برنامه جدیدتر است» issue.
  7. Screenshot verified (dark mode): warning box, export button + last-
     export line, upload picker, red error box; RTL + active تنظیمات nav;
     console clean. Demo data cleared afterwards; empty states re-verified.

Phase 11 (all re-run together):
- `npm run typecheck` — clean; `npm test` — **202 tests pass (15 files)**
  (no unit changes needed — this phase is static assets + wiring);
  `npm run build` — clean (JS 103.24 kB / gzip 25.80 kB).
- `npm run gen:icons` — deterministic PNGs written to public/; the 512px
  icon was visually verified in the browser against the SVG favicon
  (teal rounded tile + white car-front glyph render identically).
- Manual PWA verification against the production build (vite preview on
  4173, real browser):
  1. First load registers the service worker; it activates immediately
     (`skipWaiting` + `clients.claim`) and controls the page.
  2. Cache inspection: `car-maintenance-shell-v1` holds all 11 shell
     entries — index.html + `/`, the hashed JS and CSS, all four Vazirmatn
     woff2 fonts (found by parsing the CSS `url(...)` refs), icon.svg,
     icon PNGs, and the manifest.
  3. Offline-equivalence proof: after a controlled reload, the navigation
     document and every resource reported `transferSize = 0` (served from
     the SW cache; zero bytes over the wire) — with cache-first serving,
     offline reloads take exactly this path.
  4. The origin server was then fully stopped and the built app had
     already been captured fully functional from cache (RTL Persian UI,
     fonts, lucide icons, catalog interaction) — §44 “continues functioning
     without network” is met.
  5. Build output checked: dist/ contains sw.js, manifest.webmanifest and
     the three icon PNGs next to the hashed assets.
- Server hygiene note: the preview server and dev server were restarted
  cleanly afterwards; the dev server on 5173 is running for future phases.

Phase 12 (all re-run together):
- `npm run typecheck` — clean; `npm test` — **205 tests pass (15 files)**, 3
  new + 2 updated: repository v2 migration coverage (version-0 and version-1
  fixtures now land on CURRENT_VERSION with `theme: "system"` added),
  import validator theme checks (missing/unknown value rejected, all three
  preferences accepted).
- `npm run build` — clean (JS 106.55 kB / gzip 26.70 kB).
- Manual dev-server verification (Preview tab, 5173):
  1. تنظیمات now opens with a ظاهر card (radiogroup سیستم/روشن/تیره,
     سیستم active by default).
  2. تیره → `data-theme="dark"` on <html>, theme-color meta #0e1513,
     stored dataset version 2 + `settings.theme: "dark"`; screenshot
     confirms the dark palette + active segmented pill.
  3. Reload → still dark (persistence + pre-paint script). روشن →
     attribute removed, meta #0f3d33, stored "light".
  4. Seeded a v1 dataset (settings without theme): app loads, control
     shows سیستم (migrated default), saving a theme bumps storage to
     version 2 — in-place migration works.
  5. Duplicate notice: with روغن موتور already ACTIVE, opening its
     catalog entry shows the box--warn notice naming the item; save is
     still allowed (decision 29).
  6. Form preservation (decision 31): typing a custom name + km, then
     clicking an icon (full redraw) and toggling بازرسی on/off (section
     swap redraws) kept every value; opening a NEW catalog-add cleared the
     stale values (name showed the catalog prefill, notice intact).
  7. Console clean throughout; demo data cleared afterwards (fresh empty
     state re-verified).

Phase 13 (all re-run together):
- `npm run typecheck` — clean; `npm test` — **205 tests pass (15 files)**
  (no unit changes needed — this phase is verification; the two code
  fixes are the SW cache bump and a deleted unused i18n key); `npm run
  build` — clean (JS 106.37 kB / gzip 26.66 kB, new asset hashes).
- Manual verification (Preview tab, dev 5173 + built app on 4173):
  1. §49 live spot-checks — engine output for all five seeded items
     matched hand-math exactly (details in the Phase 13 section above),
     including the never-inspected-inspection edge (نیازمند بازرسی chip,
     no fabricated metrics, no calendar link).
  2. Recorded the belt's first inspection (condition خوب) → chip flipped
     to خوب, §33 overview + history updated in place, dashboard summary
     re-counted to ۰/۰/۵.
  3. Vehicle odometer form: decrease warning (۲٬۰۰۰ km), >5,000 km jump
     warning (۶٬۰۰۰ km), negative-value inline error with history
     untouched, cancel restored the summary card.
  4. Theme: تیره applied `data-theme` + #0e1513 meta and survived a
     reload with no flash; restored to سیستم. Backup/restore cards
     render complete.
  5. RTL/keyboard: root + computed direction rtl; Tab order logical on
     the detail page (back → actions → nav); row links activate.
  6. Built PWA audit on 4173: SW served with `car-maintenance-shell-v2`,
     manifest (fa/rtl/standalone, 3 icons) and PNGs in dist, hashed
     assets match the SW precache discovery, registration in the built
     JS. Console clean throughout; demo data cleared afterwards (fresh
     empty state re-verified).

---

## Important Technical Decisions

Phase 1 (keep in mind):
1. **Stack: vanilla TypeScript + Vite + Vitest + Lucide, no UI framework.**
   The project plan (§5) demands simple architecture, minimal dependencies,
   native browser capabilities, and no unnecessary abstractions; there was no
   existing project to inherit a stack from. A framework would add
   dependencies without meeting a hard requirement. The UI stays component-
   based via modular view modules + a central render loop (full re-render per
   route change — fine for a personal app).
2. **`base: "./"` in Vite** — relative asset URLs, so GitHub Pages hosting
   works from any sub-path. Keep this; do not switch to absolute paths.
3. **RTL is structural** — `dir="rtl"` on `<html>` plus CSS logical
   properties (`margin-inline`, `inset-inline`, `text-align: start`). Never
   write direction-specific left/right layout rules.
4. **Vazirmatn self-hosted in `public/fonts/`** — the PWA must work offline
   (Phase 11); a CDN font would break that. `font-display: swap` is used.
5. **Hash routing** (`#/dashboard`) — zero-config static hosting; also keeps
   the router pure and unit-testable.
6. **PostCSS global-config interference (environment issue, important!).**
   The machine has `~/postcss.config.mjs` (Tailwind) that Vite 8 discovers by
   walking up from the project and fails on. Fix: inline `css.postcss:
   { plugins: [] }` in `vite.config.ts`, which makes Vite ignore config
   files. If a future phase needs PostCSS plugins, add them to this inline
   config — do not create a `postcss.config.mjs` at the project root unless
   the global config is removed.
7. **Lucide key lookup** — `createIcons` converts `data-lucide` values with
   `toPascalCase` and looks up PascalCase keys in the icons object. Keep the
   registry keys PascalCase (e.g. `CarFront`), attribute values kebab-case.
8. **i18n keys are dot paths** (`nav.dashboard`); the `fa.ts` object is the
   single source of truth and defines the message type. Adding a locale later
   = add a dictionary + extend `Locale`.

Phase 2:
9. **`currentOdometer` is NOT persisted on the Vehicle.** §9 lists it in the
   vehicle model, but §4 ("store facts, not derived values") and §10 ("the
   latest valid reading becomes the current odometer") make odometer history
   the authoritative fact. `getCurrentOdometer()` derives it. This avoids two
   sources of truth that could drift. Phase 4 (odometer UI) must go through
   odometer history.
10. **Last service / last inspection are derived from history, not stored**
    on the maintenance item (§18, §35). Recording a service creates a
    `ServiceRecord` and the baseline automatically moves to it — no
    duplicate state to keep in sync. `lastServiceFor()` /
    `lastInspectionFor()` implement this.
11. **Event dates are date-only ISO strings ("yyyy-mm-dd"); created
    timestamps are full ISO datetimes.** ISO strings sort lexicographically,
    so all ordering uses plain string comparison (no date parsing, no
    timezone bugs). Phase 3 calculations will parse dates explicitly where
    day arithmetic is needed.
12. **Rule model has no `type` enum** (§15 forbids `type: km|time|…`):
    `intervalKm` / `intervalMonths` are independent nullable criteria,
    `trigger: "any"` combines them, and `inspectionBased` marks
    inspection-status items. "Custom" items are not a separate rule kind —
    a custom item is just user-defined name + any rule (§16, §37).
13. **Full structural validation is deferred to Phase 10 (import).** Phase 2
    loading is defensive only: corrupt/unsupported data falls back to the
    default dataset with a console warning, never a crash. Do not conflate
    the two.
14. **`ServiceRecord` includes `cost` and `notes`; `brand`, `partNumber`,
    `quantity` were deferred** per §17 ("only add if they provide meaningful
    value"). If a future phase wants them, add optional fields + a schema
    version bump + migration.
15. **`StatusThresholds` defaults (dueSoon 20% / due 5%) are provisional**
    until Phase 3 pins down threshold semantics (§29). The Settings schema
    will not change; only the default values may be tuned.

Phase 3:
16. **`today` is an injectable parameter** on `calculateMaintenance` (default
    `todayIso()`, the user's local date). All date arithmetic is pure UTC
    whole-day numbers — no timezone/DST bugs; tests are fully deterministic.
17. **Status tier semantics** (§29): OVERDUE = past due (remaining < 0 on
    either criterion); DUE = 0% ≤ remaining% ≤ duePercent; DUE_SOON =
    duePercent < remaining% ≤ dueSoonPercent; UPCOMING = below 100%; OK =
    100%+. This makes "OK" the just-serviced state and "UPCOMING" the normal
    cruising state — the Phase 7 dashboard summary may group them together.
18. **Primary trigger (§25): the earlier of (today + remainingKm ÷ avgDaily)
    vs the time due date wins; ties prefer the real calendar date over the
    distance estimate.** When the km trigger can't be estimated (no/zero
    average distance, §11), time wins; a single configured criterion wins
    when computable.
19. **Percentage (§28) is computed against the primary criterion only**
    (km: remainingKm ÷ intervalKm; time: remainingDays ÷ exact interval
    calendar days), clamped to 0–100, returned as a raw float (UI rounds).
    For km-OR-time items the non-primary criterion's percentage is not
    computed — avoids ambiguous double percentages.
20. **Estimated km days round UP** (`Math.ceil`) so the estimate never
    understates urgency (§24). The estimated date is always labeled an
    estimate in the UI (Phase 7/8).
21. **Inspection items never receive a fabricated percentage/remaining
    life** (§16/§28); their status comes from the inspection record
    (condition + optional km/month inspection interval) only.

Phase 4:
22. **Readings are never deleted** (§10 "never discard previous readings");
    corrections are done by editing a reading in place (id/createdAt kept).
    If deletion is ever wanted it must be an explicit user action + a
    documented decision.
23. **Future-dated odometer readings are rejected** — they would make the
    derived "current" odometer come from the future and skew all estimates.
    Service/inspection date inputs in later phases should apply the same
    rule.
24. **Odometer decreases and large jumps (> 5,000 km, `LARGE_INCREASE_KM`)
    warn but are allowed** — legitimate cases exist (cluster replacement,
    typo correction) and history stays inspectable/editable. The threshold
    is a documented constant.
25. **Persian-digit inputs are normalized** (`toLatinDigits`) because the
    Persian keyboard layout is the primary input method; `Intl` fa-IR
    handles output formatting (digits, separators, Jalali dates) without any
    library.
26. **Store subscriptions are scoped to the mounted view** — views return a
    dispose fn; `main.ts` disposes before swapping routes. Any new view that
    subscribes must return its unsubscribe.
27. **View-local UI state (open forms, editing flags) lives in module
    state, not the store** — it is not persisted and resets on route change.
    When a submit both mutates the store AND closes a form, set the local
    state BEFORE calling `store.update` so the notify-driven re-render shows
    the closed state.

Phase 5:
28. **Catalog intervals are recommendations, stored as data (not i18n).**
    Names use the §7 `{fa, en}` shape inside the catalog itself; the i18n
    test walks only the UI dictionary, so catalog integrity has its own
    test file. When the MVP ships fa-only, `itemFromCatalog` snapshots the
    fa name into the item (re-resolvable later via `catalogId`).
29. **Duplicate activation is allowed** (adding engine oil twice creates
    two items) — harmless for a personal tool; a duplicate warning could be
    a Phase 12 polish.
30. **Deactivation hides the item (active:false), never deletes** — data is
    preserved for the Phase 8 detail-page lifecycle (edit/restore/delete).
    There is currently no UI to re-activate or permanently delete; Phase 8
    owns that.
31. **Search + tab + icon choice survive re-renders via module state**;
    the custom form's text inputs reset after a successful create (by
    design). A store update while the custom form is open (e.g. clicking
    deactivate on another row) also resets the inputs — acceptable, noted.

Phase 6:
32. **One unified item form serves catalog-add, custom, and edit** — single
    validation + build path, no UI divergence (§19/§37). Edit mode does NOT
    collect service data (baseline changes go through service recording,
    Phase 8) and does not touch history.
33. **Initial service/inspection data is optional but atomic**: a record is
    created only when a date is provided (odometer/condition alone without
    a date is an error), and validation runs before ANY write — the item is
    never created without its valid initial data.
34. **Display mode is persisted on the item** (§26) but not yet consumed —
    Phase 7 applies it when rendering remaining-life metrics.
35. **Form checkbox state (inspectionBased) renders from module state, not
    the prefill**, so the toggle + section swap survive re-renders; the
    open-form handlers re-seed state from template/item each time.

Phase 7:
36. **Presentation never recomputes calculations** (§48): the UI formats the
    engine's `calculateMaintenance` result only. `src/ui/maintenance-
    display.ts` holds no thresholds or formulas — changing them means
    changing the engine + its tests, not the view.
37. **Auto display mode shows the primary criterion's metric first**
    (km or time per the item's own criteria — decision 18's primary
    trigger), with the other as the secondary line (§27 “actionable
    first”). `displayMode: both` is the explicit opt-out that shows both
    lines as co-primary.
38. **Summary chips group into three buckets** (§30): گذشته = overdue;
    به‌زودی = due + dueSoon + inspectionRequired; خوب = upcoming + ok.
    UPCOMING is a cruising state, so it counts as “good” on the dashboard
    even though the list still renders its own chip (در پیش).
39. **Status chips are never color-only** (§29): every chip carries an icon
    + Persian label; color is redundant reinforcement. Progress bars use
    the status palette; inspection items show no bar (decision 21).
40. **Estimated due dates are labeled تخمین only when km-estimated**;
    calendar-based due dates (from a real interval anchor) are labeled
    سررسید. `estimatedDueDate` is always an estimate by construction (§31)
    while `nextDueDate` is real — the UI distinguishes them.

Phase 8:
41. **A recorded inspection REQUIRES a condition.** The model allows a null
    condition, but the engine maps a null condition to “ok” (status.ts
    default branch) — recording a condition-less inspection would silently
    mark the part good. §36's condition list is therefore enforced by
    `validateInspectionRecordEntry`. (The Phase 6 initial-inspection data
    stays optional on item creation — different flow.)
42. **History records are edited in place, never deleted** (§34 + decision
    22 philosophy): the only way to correct a service/inspection event is
    ویرایش on its history row (id + createdAt kept, derived baseline
    re-computes automatically). Deleting a record would silently rewrite
    history and the baseline.
43. **Permanent item deletion requires prior deactivation** (only غیرفعال
    items offer حذف) and uses an INLINE two-step confirm (no
    `window.confirm` — testable, styled, RTL). It removes the item AND its
    service/inspection records: an item without history is a full delete.
    Deactivation stays reversible (فعال‌سازی دوباره).
44. **The detail page is a mode of the maintenance view, not a new route**
    — `#/maintenance/<itemId>` parses to the existing maintenance route
    (nav highlight + subscription/dispose logic in main.ts untouched); the
    item id is read from the hash on every draw. Record-form module state
    is scoped by itemId so stale state can't open a form for the wrong item.
45. **Service events may omit the odometer** (empty → null): date is the
    only required field (§35 “select/confirm date”, model allows null). The
    form defaults it to the current odometer to make the common case
    one-tap. Cost is optional (may be 0) and accepts decimals.

Phase 9:
46. **Calendar events are all-day by default** — a maintenance due date is
    a day, not a time slot, and all-day avoids timezone math in the URL.
    Google's `dates` range end is EXCLUSIVE, so the link spans
    `date/date+1`; `dayAfterIso` uses UTC arithmetic (leap-safe).
47. **The `dates` value keeps a literal slash** in the query string —
    `URLSearchParams` would encode it as `%2F` and Google rejects that;
    only `text`/`details` are `encodeURIComponent`-encoded.
48. **The calendar link appears only when a date is computable**
    (`calc.estimatedDueDate ?? calc.nextDueDate` — the primary criterion's
    date, real or estimated per §31). Never-serviced and pure inspection
    items get no link: there is nothing to remind about, and §36 forbids
    pretending a predictable date exists. Deactivated items don't get a
    reminder either.

Phase 10:
49. **Import is strict and fail-closed; loading stays defensive** (decision
    13 fulfilled). `validateImportText` parses → gates the version →
    migrates via the SAME `migrateRaw` table as loading (extracted from
    repository.ts) → validates every field: exact types, enums, ranges,
    required fields, ISO dates, per-collection duplicate ids, and
    service/inspection references to items present in the file (orphans
    would be silently invisible). Any issue → `ok:false` with a JSON-path
    list; the UI leaves current data untouched (§42). Extra unknown
    top-level keys are tolerated (forward-compatible within a version).
50. **Import requires all six top-level fields to exist** — no silent
    defaulting on import (unlike defensive loading, which repairs shape).
    App-produced exports always contain them, so a file missing e.g.
    `settings` is simply rejected with missingField issues.
51. **Export stamps `exportedAt` into the LIVE dataset** (§41): exporting
    is a data change — the stamp persists and the view re-renders «آخرین
    پشتیبان‌گیری». The downloaded file is the pretty-printed stamped
    dataset (`buildExport` also normalizes `version`). No libraries: a
    Blob + `<a download>` suffices.
52. **Import requires preview + explicit confirm** (§40 step 5–6): summary
    rows (file's exportedAt, vehicle name, per-collection counts) plus the
    §43 overwrite warning; only «جایگزینی داده‌های فعلی» calls the atomic
    `store.replace`. The UI caps the inline error list at 15 with a «N
    مشکل دیگر» tail (the validator itself reports everything).

Phase 11:
53. **The service worker never caches data.** localStorage is the source
    of truth; only immutable shell assets are cached. A stale asset cache
    must never look like user data (§44 non-goals: no sync/backends).
54. **Cache-first with shell precache, and the CACHE constant is the
    release version.** The worker precaches index.html + whatever it
    references (discovered at install: `src`/`href` in HTML, then
    `url(...)` in the CSS for the self-hosted fonts) so the SECOND load is
    offline-capable without a build plugin. Bump `car-maintenance-shell-`
    when deploying changed assets; the activate handler evicts old ones.
    (vite-plugin-pwa was deliberately avoided — no new dependency.)
55. **Raster icons are generated, not committed-by-hand**: a dependency-
    free script (`npm run gen:icons`) rasterizes the exact favicon art
    (mini SVG-path parser + distance-to-stroke rendering + hand-rolled
    PNG encoder). Re-run it after any favicon redesign; the PNGs are
    committed so the build needs no node-canvas at build time.

Phase 12:
56. **The theme is data-attribute driven, not CSS-media driven.** Dark
    values live under `:root[data-theme="dark"]`; JS (theme.ts) resolves
    “system” against `prefers-color-scheme` and listens for OS changes
    while system is selected. This needs no duplicated palette blocks and
    makes the manual toggle trivially correct.
57. **Anti-paint-flash duplication is deliberate and commented**: the
    ~6-line pre-paint script in index.html mirrors theme.ts (storage key +
    settings.theme path). If that schema ever changes, both places must be
    updated (comments point at each other).
58. **Theme preference is part of the v2 Settings schema** (not a separate
    key) so export/import and the single-store invariant keep working; the
    migration step + validator live on the SAME path as loading (decision
    49), so v1 backups import cleanly and old localStorage migrates in
    place on next load/write.

Phase 13:
59. **A manual QA pass is the project's final gate; Lighthouse is an
    optional extra, not a requirement.** Phase 13 verified every flow,
    §49 calculations, RTL/keyboard, and the built PWA structurally
    (manifest/SW/icons/assets) in a real browser; an automated
    Lighthouse run is listed as an optional follow-up because the
    toolchain has no Lighthouse binary and nothing it would flag was
    found manually. The SW `CACHE` bump to v2 (this phase) is the
    routine deploy step of decision 54 — no new behavior.

Post-Phase-13 visual restyle (user-requested, outside the phase plan):
60. **The visual identity is now ORANGE + warm neutral grays** (user
    request; replaces the teal/green M3 seed of decision 1's palette). All
    colors still flow through the same role tokens in `tokens.css` — no
    component CSS or layout changed. Light neutrals are warm grays
    `#f6f5f3` surface → `#ffffff` lowest; dark is built around the
    requested `#151619` with `#1c1d20` cards and `#212226` containers.
    Semantic status colors stay distinct: ok=green, upcoming=blue,
    due-soon=amber, due=burnt orange (light `#9a4f00` / dark `#e6a07c`),
    overdue=red; warnings/errors keep their amber/red and the vivid brand
    orange `#F2870D` is never used for them (decision 60b keeps this).
    Outline-variant borders were rebalanced (`#8c8984` light / `#6b6761`
    dark, ≥3:1 against surfaces) because the new grays are darker/lighter
    than the old tinted ones. Chrome/meta colors and the app/favicon art
    (icon.svg + `gen-icons.mjs` BG, PWA PNGs regenerated with
    `npm run gen:icons`) were matched to the brand. Contrast was verified
    numerically for every role pairing and visually in both themes;
    typecheck/tests/build all green.

60b. **The primary/brand color is EXACTLY `#F2870D` in both themes** (user
    follow-up request — explicitly overriding decision 60's WCAG-driven
    darker primary). `--md-sys-color-primary` and
    `--md-sys-color-inverse-primary` are `#f2870d` verbatim in light AND
    dark (no darkening, no per-theme variant); `on-primary` is white in
    both themes, so filled buttons are white-on-`#F2870D`. Chrome/meta
    (`theme.ts` light `#f2870d`, index.html meta, manifest `theme_color`)
    and the icon art (SVG + generator + PNGs) match. Status/due, warning,
    and error colors were NOT changed. Do not silently darken the brand —
    decision 60b takes precedence.

60c. **Foreground on the primary is now BLACK `#000000`** (user follow-up
    request): `--md-sys-color-on-primary` is `#000000` in both themes, so
    text/icons on `#F2870D` backgrounds (the `.btn--filled` buttons — ثبت
    خودرو, افزودن, ذخیره, etc.) render black-on-orange. The primary color
    itself stays exactly `#f2870d` and all other colors are unchanged.
    Black-on-`#F2870D` measures ~7.0:1 (WCAG AA/AAA pass) — this also
    resolves the 2.55:1 white-on-orange concern noted in decision 60b.
    Note: `#F2870D` as TEXT on the light `#f6f5f3` surface remains
    2.34:1 (links, text buttons, active nav label) — inherently low for
    the exact brand hue and not part of this request.

---

## Known Issues / Limitations

- The سوابق (history) view is still a placeholder (could become an
  aggregate record log; records live per-item on the Phase 8 detail pages).
- Import replaces the whole dataset — there is no merge/selective restore
  (deliberate, §42; re-importing an older backup is the undo path).
- Import is strict by design: a hand-edited file missing any of the six
  top-level keys is rejected rather than silently defaulted (decision 50).
- The settings error box caps the visible issue list at 15 (+ «N مشکل
  دیگر»); the validator itself reports every problem.
- The dashboard priority list caps at the top 5 by urgency (fine for
  personal use).
- Individual history records cannot be deleted — only edited (decision 42,
  deliberate).
- `createIcons` warns (console) and skips an icon if a `data-lucide` name is
  not in the registry — add new icons to `src/ui/icons.ts`'s `iconRegistry`.
- Theme is JS-applied (decision 56): tokens no longer auto-switch on the
  OS media query alone, so without JavaScript the app stays light —
  acceptable for this app (module scripts always run; pre-paint script
  covers first paint).
- Deploying changed assets requires bumping the SW `CACHE` constant
  (decision 54); the SW itself is only registered in production builds, so
  the vite dev server never caches (verified).
- Percentage is not computed for the non-primary criterion of km-OR-time
  items (decision 19).
- A formal Lighthouse/Chrome-DevTools automated audit was NOT run (no
  Lighthouse binary in the toolchain); Phase 13 instead verified
  installability structurally (manifest/SW/icons in the built dist +
  live offline serving from Phase 11) plus manual a11y/keyboard/RTL
  passes — all criteria were met manually (Phase 13).

---

## Exact Next Steps

The project is COMPLETE (all 13 phases). No planned work remains. Optional
follow-ups (each small and self-contained; none are required for daily
use):

1. **سوابق aggregate log view** — the history tab is still a placeholder;
   a simple newest-first log of every service/inspection record across
   items (with item names, Jalali dates, cost/condition) would use data
   that already exists (the per-item history on detail pages is complete).
2. **Formal Lighthouse audit** — run Lighthouse (or Chrome DevTools) on
   the built PWA once, outside this toolchain, to get official
a11y/installability scores; Phase 13's manual checks found no issues.
3. **Commit / deploy** — all work since the initial plan commit is
   uncommitted (see Git note above). Commit the project and deploy `dist/`
   (GitHub Pages sub-path is supported: relative base + manifest/SW
   scope). Remember to bump the SW `CACHE` constant when deploying.
4. **English locale** — the i18n catalog is structure-ready for `{fa,en}`
   (Phase 1 scaffolding) but only fa ships; adding an en catalog + locale
   switcher is a self-contained future feature.

Future work must keep decisions 1–59 in mind (they are the project's
contract). If the project is picked up later, read SKILL.md →
PROJECT_PLAN.md → this file, in that order.

---

## Files Changed / Created

Phase 1:
```
package.json, package-lock.json, tsconfig.json, vite.config.ts,
.gitignore, index.html
public/icon.svg
public/fonts/Vazirmatn-{Regular,Medium,SemiBold,Bold}.woff2
src/main.ts
src/i18n/{index.ts, fa.ts}
src/ui/{router.ts, placeholder.ts}
src/views/{index.ts, dashboard.ts, maintenance.ts, history.ts, vehicle.ts, settings.ts}
src/styles/{fonts.css, tokens.css, base.css, layout.css, components.css}
tests/{i18n.test.ts, router.test.ts}
```

Phase 2:
```
src/domain/{types.ts, defaults.ts, ids.ts, odometer.ts, baselines.ts}
src/persistence/repository.ts
src/state/store.ts
tests/{domain.test.ts, persistence.test.ts, store.test.ts}
```

Phase 3:
```
src/domain/maintenance/{dates.ts, rules.ts, calculations.ts, status.ts, index.ts}
(renamed: src/domain/maintenance.ts → src/domain/baselines.ts)
(edited: src/domain/odometer.ts — readonly signatures)
tests/{dates.test.ts, calculations.test.ts, status.test.ts}
(edited: tests/domain.test.ts — baselines import + array args)
```

Phase 4:
```
src/views/vehicle.ts (new — full vehicle/odometer UI)
src/views/dashboard.ts (rewritten — vehicle summary card)
src/views/index.ts (view dispose contract)
src/ui/icons.ts (new — shared icon registry)
src/ui/{format.ts, escape.ts} (new)
src/domain/vehicle.ts (new — vehicle validation)
src/domain/odometer.ts (added validateOdometerEntry etc.)
src/i18n/fa.ts (common/vehicle/dashboard keys)
src/styles/components.css (forms, info list, vehicle summary, odometer, history)
tests/vehicle.test.ts (new — 18 tests)
```

Phase 5:
```
src/catalog/{types.ts, categories.ts, catalog.ts, index.ts} (new)
src/domain/item-factory.ts (new)
src/views/maintenance.ts (rewritten — catalog browser + custom form)
src/ui/icons.ts (31 icons + CUSTOM_ICON_CHOICES)
src/i18n/fa.ts (maintenance.* keys; removed unused description)
src/styles/components.css (tabs, item lists, catalog groups, icon picker)
tests/catalog.test.ts (new — 13 tests)
```

Phase 6:
```
src/domain/item-factory.ts (rewritten — ItemDraft/buildItem/initial validators)
src/views/maintenance.ts (rewritten — unified add/edit configuration form)
src/i18n/fa.ts (maintenance.form/display/condition keys)
src/styles/components.css (segmented control, item actions)
tests/item-form.test.ts (new — 18 tests)
PROJECT_PLAN.md (status + progress section updated)
PROCESS.md (this file)
```

Phase 7:
```
src/ui/maintenance-display.ts (new — metric/status presentation helpers)
src/views/maintenance.ts (live rows: status chip, metrics, progress, sort)
src/views/dashboard.ts (rewritten — summary chips + priority list)
src/ui/icons.ts (status icons: CircleCheck/CircleAlert/OctagonAlert/TriangleAlert)
src/i18n/fa.ts (status.* labels, maintenance.list.* keys)
src/styles/components.css (status chips, progress bars, summary chips)
tests/maintenance-display.test.ts (new — 17 tests)
PROJECT_PLAN.md (progress tracking updated)
PROCESS.md (this file)
```

Phase 8:
```
src/domain/records.ts (new — event validators + newest-first sorting)
src/ui/router.ts (detail hashes: parse → maintenance, id extraction, link builder)
src/views/maintenance.ts (detail-page mode: overview/§33 explanation, record & edit
  forms, history sections, lifecycle actions; rows link to detail)
src/views/dashboard.ts (priority rows link to the detail page)
src/i18n/fa.ts (maintenance.detail.*, maintenance.record.*, inactiveTitle)
src/styles/components.css (item-list__main, status-chip--inactive, btn--danger,
  delete-confirm, detail-*, history__note)
tests/records.test.ts (new — 10 tests)
tests/router.test.ts (detail-hash parsing — 4 new tests)
PROJECT_PLAN.md (progress tracking updated)
PROCESS.md (this file)
```

Phase 9:
```
src/ui/calendar.ts (new — pure Google Calendar URL builder)
src/views/maintenance.ts (add-to-calendar link in the detail actions row)
src/ui/icons.ts (CalendarPlus registered)
src/i18n/fa.ts (maintenance.detail.addToCalendar / calendarEventNote)
tests/calendar.test.ts (new — 6 tests)
PROJECT_PLAN.md (progress tracking updated)
PROCESS.md (this file)
```

Phase 10:
```
src/persistence/import-export.ts (new — strict validator + export helpers)
src/persistence/repository.ts (migrateRaw extracted + exported; loadFromString reuses it)
src/views/settings.ts (rewritten — backup/restore cards, preview + confirm)
src/ui/icons.ts (Download, Upload registered)
src/ui/format.ts (formatDateTime added)
src/i18n/fa.ts (settings.* keys incl. issue labels; view.settings.description dropped)
src/styles/components.css (.visually-hidden, .box--warn/error/success, settings page styles)
tests/import-export.test.ts (new — 51 tests)
PROJECT_PLAN.md (progress tracking updated)
PROCESS.md (this file)
```

Phase 11:
```
public/manifest.webmanifest (new — fa/rtl PWA manifest)
public/sw.js (new — cache-first service worker with shell precache)
public/icon-{180,192,512}.png (new — generated, see below)
scripts/gen-icons.mjs (new — dependency-free rasterizer for the icons)
index.html (manifest + apple-touch-icon + dark theme-color + mobile metas)
src/main.ts (registerServiceWorker — production builds only)
src/vite-env.d.ts (new — vite/client types)
package.json (gen:icons script)
PROJECT_PLAN.md (progress tracking updated)
PROCESS.md (this file)
```

Phase 12:
```
src/domain/types.ts (ThemePreference + Settings.theme)
src/domain/defaults.ts (CURRENT_VERSION 2; default theme system)
src/persistence/repository.ts (migration step 1; normalizeSettings theme)
src/persistence/import-export.ts (settings.theme validation)
src/ui/theme.ts (new — resolve/apply/sync theme + theme-color meta)
src/main.ts (registerThemeSync at boot)
index.html (pre-paint theme script; single JS-managed theme-color meta)
src/styles/tokens.css (dark palette under [data-theme]; per-theme color-scheme)
src/views/settings.ts (ظاهر card with segmented theme radiogroup)
src/views/maintenance.ts (duplicate notice; formValues preservation)
src/i18n/fa.ts (settings.appearance/theme*, maintenance.form.duplicateNotice)
src/styles/components.css (.settings-theme row spacing)
tests/persistence.test.ts (v2 migration coverage — 2 updated + 1 new)
tests/import-export.test.ts (theme validator cases — 2 new)
PROJECT_PLAN.md (progress tracking updated)
PROCESS.md (this file)
```

Phase 13:
```
public/sw.js (SW cache bump v1 → v2 for the changed Phase 12 shell)
src/i18n/fa.ts (removed stale view.vehicle.description placeholder copy)
PROJECT_PLAN.md (status → COMPLETE; Phase 13 [x])
PROCESS.md (this file — Phase 13 QA record, decision 59)
```

No new files were needed: Phase 13 was a verify-and-fix pass over the
complete Phase 1–12 implementation.
