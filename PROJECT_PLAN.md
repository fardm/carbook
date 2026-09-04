# Car Maintenance Tracker — Project Plan

> **Status:** Planning  
> **Version:** 1.0  
> **Product type:** Personal-use PWA  
> **Primary language:** Persian (RTL)  
> **Storage:** LocalStorage  
> **Backend:** None  
> **Database:** None

---

# 1. Project Overview

Build a modern, minimal, local-first **car maintenance tracker PWA**.

The application acts as a personal digital maintenance logbook.

The user registers their vehicle, records the current odometer periodically, adds maintenance items, records services/replacements, and the application automatically calculates the remaining maintenance life.

The application must minimize manual calculations and provide a clear answer to:

> **What maintenance needs attention soon?**

The application is designed for personal use and must remain simple.

---

# 2. Product Goals

## Primary Goals

- Track vehicle maintenance and consumables.
- Track current odometer.
- Preserve odometer history.
- Preserve service/replacement history.
- Automatically calculate remaining maintenance life.
- Support kilometer-based maintenance.
- Support time-based maintenance.
- Support kilometer OR time maintenance.
- Support inspection-based maintenance.
- Support custom maintenance items.
- Provide recommended intervals for common maintenance items.
- Allow users to customize recommended intervals.
- Estimate due dates using average daily driving distance.
- Work offline.
- Keep user data locally.
- Allow JSON backup and restore.
- Provide optional Google Calendar reminders.

## Secondary Goals

- Clean and modern UX.
- Responsive mobile/desktop interface.
- Persian RTL interface.
- Future-ready internationalization.
- Extensible data model.

---

# 3. Non-Goals

The MVP must NOT include:

- Backend
- Database server
- Authentication
- User accounts
- Cloud synchronization
- Multi-user functionality
- Payments
- Subscription system
- Telegram notifications
- Email notifications
- Push notification infrastructure
- Google Calendar API
- Automatic calendar synchronization
- Analytics infrastructure
- Social functionality
- Complex reporting
- AI functionality

Do not implement these unless the project scope is explicitly changed later.

---

# 4. Core Product Principle

The application should store **facts**, not unnecessary calculated values.

Examples of facts:

```text
Current odometer
Last service date
Last service odometer
Maintenance interval
Average daily driving distance
Inspection result
```

Examples of derived values:

```text
Remaining km
Remaining days
Remaining percentage
Estimated due date
Expected trigger
Maintenance status
```

Derived values should normally be calculated dynamically.

Do not persist values such as:

```text
remainingKm
remainingDays
remainingPercentage
```

as authoritative data.

---

# 5. Technology Principles

Use the existing project stack if a project already exists.

Do not replace the framework without a strong technical reason.

The implementation should be:

- Component-based
- Modular
- Type-safe where supported
- Easy to maintain
- Easy to test
- Responsive
- Accessible
- Offline-capable

Avoid unnecessary dependencies.

---

## Web Application, Online & Offline Behavior

The application is a **web-based Progressive Web App (PWA)**.

It must work as a normal website when accessed online and should also support offline usage after the application has been loaded and cached.

The application is intended to be hosted on **GitHub Pages** as a static website.

Architecture:

* GitHub Pages serves the application's HTML, CSS, JavaScript, and PWA assets.
* Application logic runs entirely in the user's browser.
* User data is stored locally in the browser using `localStorage`.
* The Service Worker caches the application shell and required static assets for offline usage.
* Maintenance calculations must work without an internet connection.
* No backend server, database, authentication, or cloud storage is required for the MVP.

The application should provide a responsive experience from a **single codebase** across:

* Desktop browsers
* Mobile browsers
* Tablets
* Installed PWA on supported devices

## Important Local-First Principle

"Local-first" does **not** mean the application is offline-only.

The application is an online website that can be accessed normally through the internet, but the user's personal vehicle and maintenance data remains stored locally on their device.

Internet connectivity is therefore required primarily for:

* Initial loading of the application when it is not cached
* Application updates
* External services such as opening Google Calendar

Core functionality must remain usable offline once the application has been cached.

## Data Synchronization

LocalStorage data is isolated per browser/device.

Therefore:

* Desktop and mobile devices do **not** automatically synchronize data.
* Different browsers on the same device may also have separate data.
* JSON Export/Import is the MVP mechanism for transferring or backing up data between devices.

Cloud synchronization must **not** be implemented in the MVP.

If synchronization is required in a future version, it should be designed as a separate feature requiring an appropriate backend or synchronization mechanism.


# 6. Design System

Use **Material Design 3** as the primary design reference.

Official reference:

https://m3.material.io/

Use Material-style patterns for:

- Buttons
- Text fields
- Selects
- Dialogs
- Cards
- Lists
- Navigation
- Chips
- Progress indicators
- Menus
- Snackbars
- Date pickers

Use a modern icon library such as:

- Lucide

Do not use emoji as the primary icon system.

## Visual Direction

The UI should feel like a mature utility application.

Desired characteristics:

- Minimal
- Clean
- Functional
- Calm
- Information-focused
- Consistent
- Responsive

Avoid:

- Excessive gradients
- Glassmorphism
- Glow effects
- Neon colors
- Huge rounded cards
- Excessive shadows
- Decorative blobs
- Excessive animation
- AI/SaaS dashboard aesthetics

The interface should prioritize information hierarchy over decoration.

---

# 7. Localization

The initial UI language is:

> Persian / RTL

The application should nevertheless be i18n-ready.

Use language-independent IDs.

Correct:

```text
engineOil
oilFilter
brakePadsFront
```

Incorrect:

```text
روغن موتور
فیلتر روغن
لنت جلو
```

as internal IDs.

Catalog items should support localized names.

Example:

```text
{
  "id": "engineOil",
  "name": {
    "fa": "روغن موتور",
    "en": "Engine Oil"
  }
}
```

Persian should be the only enabled language in the MVP.

RTL must be considered throughout the design rather than simply applying `direction: rtl` to an English-oriented layout.

---

# 8. Application Navigation

Primary navigation:

```text
داشبورد
نگهداری
سوابق
خودرو
تنظیمات
```

Keep navigation simple.

Do not create sections that do not provide meaningful value.

---

# 9. Vehicle Model

The vehicle should contain information such as:

```text
id
name
make
model
year
fuelType
currentOdometer
averageDailyDistance
createdAt
updatedAt
```

Additional fields may be added if technically necessary.

## Current Odometer

The current odometer is a dynamic central value.

Whenever the user records a new odometer reading:

1. Validate the value.
2. Create an odometer history record.
3. Update the current odometer.
4. Recalculate all maintenance states.

---

# 10. Odometer History

Never discard previous odometer readings.

Each record should contain at least:

```text
id
date
odometer
```

Example:

```text
3 Sep — 104,500 km
20 Aug — 103,900 km
5 Aug — 103,200 km
```

The latest valid reading becomes the current odometer.

The user should be able to inspect historical readings.

---

# 11. Average Daily Distance

The user may enter an approximate:

> Average daily driving distance

Example:

```text
40 km/day
```

This value is used only for estimating future dates.

It must NOT alter actual kilometer calculations.

Example:

```text
Current: 104,000 km
Next service: 110,000 km
Average: 40 km/day

Remaining: 6,000 km
Estimated date: approximately 150 days
```

If average daily distance is unavailable or zero:

- Do not calculate an estimated kilometer-based date.
- Still show remaining kilometers.

---

# 12. Maintenance Catalog

Create a predefined catalog of common vehicle maintenance items.

The catalog represents **available item templates**, not necessarily active items.

Suggested categories:

## Engine

- Engine oil
- Oil filter
- Air filter
- Spark plugs
- Timing belt
- Timing chain
- PCV / crankcase ventilation

## Fluids

- Coolant
- Brake fluid
- Transmission fluid
- Power steering fluid
- Windshield washer fluid

## Brakes

- Front brake pads
- Rear brake pads
- Front brake discs
- Rear brake discs

## Tires & Wheels

- Tires
- Wheel alignment
- Wheel balancing

## Electrical

- Battery
- Headlights
- Brake lights
- Turn signals

## Filters

- Engine air filter
- Cabin filter
- Fuel filter

The exact catalog can be expanded later.

---

# 13. Maintenance Template Structure

Each predefined maintenance template should contain conceptually:

```text
id
name
category
icon
recommendedRules
defaultRule
trackingType
```

Recommended intervals should be based on sensible general maintenance guidance.

Where appropriate, provide a range and a suggested default.

Example:

```text
Engine Oil

Recommended range:
8,000–12,000 km

Suggested:
10,000 km

Time:
6 months
```

The application must clearly communicate that these are recommendations and may vary depending on:

- Vehicle
- Engine
- Oil type
- Manufacturer recommendation
- Driving conditions

Do not present generic intervals as universal facts.

---

# 14. Active Maintenance Items

The user's active maintenance list is separate from the catalog.

When the user adds a predefined item:

```text
Catalog template
        ↓
User configuration
        ↓
Active maintenance item
```

The user can:

- Accept recommended interval.
- Customize interval.
- Set initial service data.
- Deactivate/remove the item later.

---

# 15. Maintenance Rule Model

Do NOT represent a maintenance item using a single enum such as:

```text
type: km | time | inspection
```

A maintenance item can have multiple criteria.

The model should conceptually support:

```text
distance criterion
time criterion
inspection criterion
trigger logic
```

For example:

```text
Engine Oil

Distance:
10,000 km

Time:
6 months

Trigger:
ANY
```

This means whichever criterion occurs first determines the due state.

---

# 16. Tracking Types

Support these logical tracking modes:

## Kilometer

Example:

```text
Every 10,000 km
```

## Time

Example:

```text
Every 6 months
```

## Kilometer OR Time

Example:

```text
Every 10,000 km OR 6 months
```

The first criterion reached triggers the maintenance.

## Inspection

For items such as:

- Brake pads
- Brake discs
- Tires
- Belts

Do not fabricate exact remaining life when it cannot be reliably calculated.

Support:

- Inspection interval
- Last inspection
- Condition
- Optional measurement
- Notes

## Custom

Allow users to create custom maintenance items/rules.

---

# 17. Service / Replacement Data

A service record should contain at least:

```text
id
maintenanceItemId
date
odometer
notes
createdAt
```

Optional fields can include:

```text
cost
brand
partNumber
quantity
```

Only add these if they provide meaningful value.

---

# 18. Last Service vs Last Inspection

These are separate concepts.

Do not combine:

```text
Last changed
```

with:

```text
Last inspected
```

Example:

Brake pads may have:

```text
Last replacement:
10 Jan — 80,000 km

Last inspection:
20 Aug — 103,900 km

Condition:
Good
```

The system must preserve both.

---

# 19. Adding a Maintenance Item

The add-item flow should be simple.

For a predefined item:

```text
Select item
↓
Show recommended rule
↓
User accepts or edits
↓
Enter last service date
↓
Enter service odometer
↓
Save
```

The user should not be forced to calculate anything.

---

# 20. Recommended Intervals

Predefined items should provide sensible defaults.

Examples:

```text
Engine Oil:
8,000–12,000 km
Suggested: 10,000 km

Cabin Filter:
10,000–20,000 km
Suggested: 15,000 km

Brake Fluid:
24 months

Tires:
Time + inspection
```

These values are defaults only.

The user must be able to customize them.

---

# 21. Maintenance Calculations

Create a centralized calculation layer.

Conceptually provide functions such as:

```text
calculateRemainingKm()
calculateRemainingDays()
calculateEstimatedDueDate()
calculateRemainingPercentage()
determinePrimaryTrigger()
calculateMaintenanceStatus()
```

Do not implement the same calculation in multiple UI components.

---

# 22. Remaining Kilometer Calculation

For a distance-based maintenance item:

```text
nextDueOdometer =
lastServiceOdometer + intervalKm
```

Then:

```text
remainingKm =
nextDueOdometer - currentOdometer
```

Example:

```text
Last service:
100,000 km

Interval:
10,000 km

Next due:
110,000 km

Current:
103,200 km

Remaining:
6,800 km
```

Every time the current odometer changes, this calculation must update automatically.

---

# 23. Remaining Time Calculation

For time-based maintenance:

```text
nextDueDate =
lastServiceDate + interval
```

Then calculate the difference between:

```text
nextDueDate
currentDate
```

Return a normalized representation suitable for UI.

Internally, calculations should use precise dates/durations.

The UI may display:

```text
120 days
```

or:

```text
~4 months
```

depending on context.

---

# 24. Estimated Date from Kilometer

If a maintenance item is kilometer-based and the vehicle has an average daily distance:

```text
daysToDue =
remainingKm / averageDailyDistance
```

Then:

```text
estimatedDueDate =
today + daysToDue
```

This date is an estimate.

Always label it appropriately.

Never treat it as the exact maintenance deadline.

---

# 25. Distance + Time Rules

For an item with both:

```text
10,000 km
OR
6 months
```

calculate both independently.

Example:

```text
Remaining distance:
6,000 km

Average:
40 km/day

Estimated distance trigger:
150 days

Remaining time:
60 days
```

Time triggers first.

Therefore the primary status should be based on:

```text
60 days
```

Another scenario:

```text
Remaining distance:
3,000 km

Average:
40 km/day

Estimated distance trigger:
75 days

Remaining time:
120 days
```

Distance triggers first.

Therefore the primary status should be based on:

```text
3,000 km
```

---

# 26. Display Modes

Each maintenance item can have a display preference:

```text
Auto
Kilometer
Time
Both
```

Default:

```text
Auto
```

## Auto

Automatically choose the criterion expected to trigger first.

## Kilometer

Show kilometer as the primary metric.

## Time

Show time as the primary metric.

## Both

Show both equally.

---

# 27. Dashboard Metric Hierarchy

Do not make percentage the primary textual value.

The primary metric should be actionable.

Preferred:

```text
7,500 km remaining
```

rather than:

```text
85% remaining
```

Percentage should primarily serve as a visual indicator.

Example:

```text
Engine Oil

7,500 km remaining
~185 days remaining

Estimated due:
18 Ordibehesht

Based on distance
```

For time-based items:

```text
Brake Fluid

120 days remaining
67% remaining
```

---

# 28. Remaining Percentage

Percentage represents remaining configured life.

Conceptually:

```text
remainingPercentage =
remainingLife / totalConfiguredLife
```

Clamp the result appropriately.

Examples:

```text
New item → 100%
Half consumed → 50%
Due → 0%
Overdue → 0%
```

Do not show a percentage if there is insufficient information to calculate it reliably.

Inspection-only items should use condition/status instead.

---

# 29. Status System

Maintenance status should be derived from remaining life.

Suggested conceptual statuses:

```text
OK
UPCOMING
DUE_SOON
DUE
OVERDUE
INSPECTION_REQUIRED
```

Exact thresholds should be configurable rather than deeply hard-coded.

The visual representation should be understandable without relying solely on color.

Use:

- Text
- Icon
- Optional color
- Progress indicator

Never communicate status through color alone.

---

# 30. Dashboard

The dashboard should answer:

> What needs attention soon?

within a few seconds.

Include:

## Vehicle summary

- Vehicle name/model
- Current odometer
- Update odometer action

## Maintenance summary

For example:

```text
Overdue
Due soon
OK
```

## Priority maintenance

Show the most relevant/urgent items.

Possible sorting:

- Expected due time
- Status
- Remaining km
- Remaining time

Avoid excessive cards and charts.

---

# 31. Maintenance List

Provide a dedicated maintenance screen.

Each item should show:

```text
Name
Category
Status
Primary remaining metric
Secondary metric
Estimated due date
Progress/status indicator
```

Example:

```text
Engine Oil

7,500 km remaining
~185 days
Estimated: 18 Ordibehesht
```

The list should support useful sorting/filtering.

---

# 32. Maintenance Detail

The detail page should contain:

- Item name
- Category
- Icon
- Current status
- Remaining km
- Remaining time
- Remaining percentage
- Estimated due date
- Triggering criterion
- Last service
- Last inspection
- Configured interval
- Calculation information
- Service history

Actions:

```text
Record service
Edit
Add to Google Calendar
Deactivate/Delete
```

---

# 33. Calculation Explanation

Users should be able to understand why the application shows a specific remaining value.

Example:

```text
Next service:
110,000 km

Current:
103,200 km

Remaining:
6,800 km
```

For time:

```text
Last service:
1 June

Interval:
6 months

Due:
1 December
```

For estimated dates:

```text
Based on average driving:
40 km/day
```

This information may be shown on the detail page rather than cluttering the dashboard.

---

# 34. Service History

Create a history section showing past maintenance events.

Example:

```text
Engine Oil
3 Sep 2026
104,500 km

Previous:
10 Mar 2026
96,800 km

Previous:
5 Sep 2025
86,200 km
```

Allow users to inspect individual records.

Never remove old service records when a new service is recorded.

---

# 35. Recording a Service

When the user records a service:

1. Select/confirm date.
2. Enter/confirm odometer.
3. Optionally add notes.
4. Save the service event.

After saving:

```text
Create history record
        ↓
Update maintenance baseline
        ↓
Recalculate remaining life
```

Previous history remains untouched.

The service odometer should default to the current odometer when appropriate.

---

# 36. Inspection Records

Inspection-based items should support a separate inspection event.

Conceptually:

```text
inspectionId
maintenanceItemId
date
odometer
condition
measurement
notes
```

Possible conditions:

```text
Good
Watch
Replace Soon
Replace Now
```

Do not pretend that inspection-based components have a predictable exact remaining kilometer value unless the user has configured a valid measurable rule.

---

# 37. Custom Maintenance Items

Users must be able to create custom items.

Required fields:

- Name
- Category
- Icon
- Tracking rule
- Service/inspection information

Custom items should use the same calculation engine as predefined items whenever possible.

Do not create a completely separate implementation path for custom items.

---

# 38. Google Calendar Integration

Google Calendar is only a reminder channel.

Do not implement:

- OAuth
- Calendar API
- Automatic synchronization
- Event ID management

Provide:

> Add to Google Calendar

Generate an appropriate calendar event creation URL.

Include when possible:

- Maintenance name
- Estimated/due date
- Useful description

The user configures the alarm/reminder manually.

The PWA remains the source of truth.

---

# 39. LocalStorage

LocalStorage is the MVP persistence layer.

Persist the application state in a versioned structure.

Conceptually:

```json
{
  "version": 1,
  "exportedAt": "...",
  "vehicle": {},
  "odometerHistory": [],
  "maintenanceItems": [],
  "serviceHistory": []
}
```

Do not scatter unrelated LocalStorage keys throughout the application unless there is a strong reason.

Prefer a centralized persistence layer.

---

# 40. Data Versioning

Every exported data set must include:

```text
version
```

Example:

```text
version: 1
```

This allows future migrations.

When importing:

1. Parse JSON.
2. Validate structure.
3. Validate version.
4. Migrate if necessary.
5. Show confirmation/preview.
6. Replace current data only after confirmation.

Never silently destroy current data.

---

# 41. JSON Export

Allow the user to export all application data.

Export should include:

- Vehicle
- Odometer history
- Maintenance items
- Service history
- Inspection history
- Relevant settings

Do not export unnecessary temporary/derived UI state.

---

# 42. JSON Import

Import must be defensive.

Validate:

- Valid JSON
- Correct root structure
- Supported version
- Required IDs
- Required fields
- Correct value types

If invalid:

```text
Do not modify existing data.
```

Show a useful error.

If valid:

```text
Show summary
↓
Ask confirmation
↓
Replace current dataset
```

---

# 43. Backup Warning

Because LocalStorage can be lost if site data is cleared, clearly communicate that:

> JSON Export is the user's backup mechanism.

Do not make the user believe their data is automatically backed up to the cloud.

---

# 44. PWA

The application must be installable as a PWA.

Requirements:

- Web App Manifest
- Service Worker
- Offline application shell
- Appropriate icons
- Responsive layout
- Installable experience

The application should continue functioning without network access after the required assets have been cached.

---

# 45. Responsive Design

Support:

- Mobile
- Tablet
- Desktop

Mobile is important because maintenance information is often entered beside the vehicle.

However, desktop should not simply be an enlarged mobile interface.

Use appropriate:

- Content width
- Navigation
- Tables/lists
- Spacing
- Density

---

# 46. Accessibility

Follow basic accessibility principles:

- Semantic HTML
- Keyboard navigation
- Visible focus states
- Proper labels
- Accessible buttons
- Sufficient contrast
- Do not rely only on color
- Appropriate touch targets
- Meaningful error messages

RTL layouts must remain accessible.

---

# 47. Edge Cases

Handle at minimum:

## Odometer

- No odometer
- First odometer entry
- Same odometer
- Odometer decreases
- Large unexpected increase
- Historical correction

## Maintenance

- No interval
- Only km
- Only time
- Both km and time
- Inspection-only
- Custom item
- Overdue item
- Exactly due item
- Recently serviced item

## Average distance

- Missing
- Zero
- Very high
- User changes the value

## Dates

- Delayed data entry
- Historical service date
- Future date accidentally entered
- Month/year boundaries
- Leap years

## Import

- Invalid JSON
- Unsupported version
- Missing fields
- Wrong data types
- Duplicate IDs

The application must never show:

```text
NaN
undefined
Infinity
negative nonsense
```

to the user.

---

# 48. Calculation Engine Architecture

Create a dedicated domain/calculation layer.

Conceptually:

```text
domain/
  maintenance/
    calculations
    status
    rules
```

The UI should consume calculation results rather than implementing calculations itself.

A calculation result may conceptually contain:

```text
status
remainingKm
remainingDays
remainingPercentage
estimatedDueDate
primaryMetric
primaryTrigger
secondaryMetric
```

Do not persist this result as authoritative application data.

---

# 49. Testing Strategy

The calculation engine must have automated tests.

## Distance

```text
Last service: 100,000
Interval: 10,000
Current: 104,000

Expected:
6,000 km remaining
```

## Time

```text
Last service: 1 January
Interval: 6 months
Current: 1 April

Expected:
Approximately 3 months remaining
```

## Distance + Time

Test:

```text
Distance triggers first
Time triggers first
```

## Overdue

Test:

```text
Current odometer > next due odometer
```

## Percentage

Test:

```text
New = 100%
Half-life = 50%
Due = 0%
Overdue = 0%
```

## Odometer update

Verify:

```text
New odometer
↓
All kilometer calculations update
```

## Service reset

Verify:

```text
New service
↓
New baseline
↓
New remaining life
↓
Previous history preserved
```

## Import/export

Verify:

```text
Export
↓
Import
↓
Equivalent dataset
```

---

# 50. Implementation Phases

Implementation must happen sequentially.

Do not implement future phases prematurely.

---

## Phase 1 — Project Foundation

### Goals

- Inspect existing project.
- Confirm framework/build system.
- Establish application structure.
- Configure base styling.
- Configure RTL.
- Configure Material-inspired design tokens/components.
- Configure icon system.
- Establish basic routing/navigation.

### Done when

- Application runs successfully.
- Base layout exists.
- RTL works.
- Navigation skeleton works.
- No unnecessary infrastructure has been introduced.

---

## Phase 2 — Data Model & Persistence

### Goals

Implement:

- Application schema
- Vehicle model
- Odometer history
- Maintenance items
- Service history
- Inspection history
- Settings
- Versioning

Implement:

- LocalStorage repository
- Load
- Save
- Clear/reset

### Done when

Data can be persisted and restored reliably.

---

## Phase 3 — Maintenance Calculation Engine

### Goals

Implement and test:

- Remaining km
- Remaining days
- Estimated due date
- Remaining percentage
- Trigger determination
- Maintenance status

Support:

- km
- time
- km OR time
- inspection
- custom rules

### Done when

All core calculations have automated tests.

Do not build polished UI yet.

---

## Phase 4 — Vehicle & Odometer

### Goals

Build:

- Vehicle setup
- Vehicle editing
- Current odometer
- Odometer update
- Odometer history

### Done when

Changing the odometer automatically changes relevant maintenance calculations.

---

## Phase 5 — Maintenance Catalog

### Goals

Implement predefined catalog.

Include:

- Categories
- Names
- Icons
- Recommended rules
- Suggested defaults

Implement:

- Browse catalog
- Add predefined item
- Add custom item

### Done when

A user can activate maintenance items from the catalog.

---

## Phase 6 — Add/Edit Maintenance

### Goals

Implement:

- Add maintenance
- Edit maintenance
- Recommended interval UI
- Custom interval
- Last service date
- Last service odometer
- Tracking rules
- Display preference

### Done when

A maintenance item can be configured without manual calculations.

---

## Phase 7 — Dashboard

### Goals

Build the main dashboard.

Include:

- Vehicle summary
- Current odometer
- Maintenance summary
- Priority items
- Status
- Primary remaining metric
- Secondary metric
- Estimated date

Implement Auto display mode.

### Done when

The dashboard immediately communicates what needs attention soon.

---

## Phase 8 — Maintenance Detail & History

### Goals

Implement:

- Maintenance detail
- Service history
- Inspection history
- Record service
- Record inspection
- Edit
- Deactivate/delete

### Done when

Complete maintenance lifecycle works:

```text
Add
→ Track
→ Update odometer
→ Service
→ Reset
→ Preserve history
```

---

## Phase 9 — Google Calendar

### Goals

Implement manual:

> Add to Google Calendar

Generate appropriate event creation URLs.

### Done when

A user can send a maintenance date to Google Calendar without authentication or API integration.

---

## Phase 10 — Import / Export

### Goals

Implement:

- JSON export
- JSON import
- Validation
- Version checking
- Confirmation
- Error handling

### Done when

A complete dataset can be exported and restored without meaningful data loss.

---

## Phase 11 — PWA / Offline

### Goals

Implement:

- Manifest
- Service worker
- Offline shell
- Installability
- Icons

### Done when

The application can operate offline after installation/cache initialization.

---

## Phase 12 — UX & Responsive Polish

### Goals

Review the complete application.

Improve:

- Mobile layout
- Desktop layout
- RTL
- Spacing
- Typography
- Forms
- Empty states
- Loading states
- Error states
- Accessibility
- Visual consistency

Avoid adding unnecessary visual decoration.

### Done when

The application feels like a polished utility rather than a prototype.

---

## Phase 13 — Final QA

### Goals

Perform a complete review.

Test:

- All calculations
- All CRUD flows
- Odometer updates
- Service reset
- Inspection
- Import/export
- PWA
- Offline mode
- Responsive layouts
- RTL
- Accessibility
- Error handling

Review the code for:

- Duplication
- Unnecessary dependencies
- Overengineering
- Dead code
- Incorrect state handling
- Incorrect derived-data persistence

### Done when

The application is stable and ready for personal daily use.

---

# 51. Progress Tracking

Maintain this section during development.

```text
Phase 1 — [ ] Not started
Phase 2 — [ ] Not started
Phase 3 — [ ] Not started
Phase 4 — [ ] Not started
Phase 5 — [ ] Not started
Phase 6 — [ ] Not started
Phase 7 — [ ] Not started
Phase 8 — [ ] Not started
Phase 9 — [ ] Not started
Phase 10 — [ ] Not started
Phase 11 — [ ] Not started
Phase 12 — [ ] Not started
Phase 13 — [ ] Not started
```

Use:

```text
[ ] Not started
[~] In progress
[x] Completed
[!] Blocked
```

After completing a phase, update this section.

---

# 52. Definition of Done

The project is considered complete when a user can:

1. Open the application.
2. Configure their vehicle.
3. Enter the current odometer.
4. Add maintenance items.
5. Accept recommended intervals.
6. Customize intervals.
7. Record previous service information.
8. See remaining kilometers.
9. See remaining time.
10. See estimated dates where possible.
11. See percentage/status where meaningful.
12. Update the odometer later.
13. See all kilometer calculations update automatically.
14. Record a new service.
15. See the counters reset.
16. Keep previous service history.
17. Record inspections.
18. Add custom maintenance items.
19. Add a reminder to Google Calendar.
20. Export data.
21. Import data.
22. Use the application offline.
23. Use the application comfortably on mobile and desktop.

---

# 53. Final Product Principles

When making implementation decisions, prefer:

```text
Simple > Complex
Explicit > Clever
Automatic > Manual
Local > Cloud
Reusable > Duplicated
Calculated > Persisted
Functional > Decorative
Clear > Clever
```

If a proposed feature does not materially improve the maintenance-tracking workflow, do not add it.

If a technical decision is uncertain, choose the simplest solution that preserves future extensibility.

The goal is not to build the largest car application.

The goal is to build a **small, reliable, polished personal maintenance tool that is genuinely useful every day.**