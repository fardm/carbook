# Car Maintenance Tracker — Agent Skill

## Mission

Build and maintain a personal, local-first car maintenance tracker PWA.

The application must remain simple, reliable, offline-first, and focused on maintenance tracking.

## Non-Negotiable Rules

- No backend.
- No database.
- No authentication.
- No cloud sync.
- No unnecessary external services.
- LocalStorage is the primary storage.
- JSON import/export is the backup mechanism.
- Persian RTL is the initial UI language.
- Code/data IDs must remain language-independent.
- Use Material Design 3 as the UI design reference.
- Use Lucide or an equivalent icon library instead of emoji.
- Avoid AI/SaaS visual aesthetics.

## Architecture

Keep these concerns separated:

- UI
- Domain/calculation logic
- Persistence
- Maintenance catalog
- Localization
- PWA

Never duplicate maintenance calculations across UI components.

All derived maintenance values must be calculated from source data.

## Source of Truth

The vehicle's current odometer is a dynamic source of truth.

When the odometer changes:

> Recalculate all kilometer-dependent maintenance states.

Do not store `remainingKm` as persistent source data.

## Maintenance Model

A maintenance item may contain multiple criteria:

- Kilometer
- Time
- Kilometer OR Time
- Inspection
- Custom

Never assume that one item can have only one tracking criterion.

## Calculation Rules

Always calculate when applicable:

- Remaining km
- Remaining days
- Remaining percentage
- Estimated due date
- Triggering criterion
- Status

For kilometer + time rules:

> Whichever criterion is expected to trigger first determines the primary due state.

## UI Rules

Primary information should be actionable.

Prefer:

> 7,500 km remaining

over:

> 75% remaining

Use percentage primarily as a visual indicator.

Do not place large donut charts on every card.

The dashboard should quickly answer:

> What needs attention soon?

## Data Integrity

Service history must never be deleted when an item is serviced.

Recording a service should:

1. Create a historical service event.
2. Set the new service as the current baseline.
3. Recalculate remaining life.
4. Preserve all previous history.

Odometer history should also be preserved.

## UX Principle

Prefer automation with sensible defaults.

The user should enter facts:

- Current odometer
- Service date
- Service odometer
- Maintenance interval when necessary

The application should calculate:

- Remaining km
- Remaining time
- Estimated date
- Status
- Triggering criterion
- Percentage

## Development Rule

Before implementing a major feature:

1. Understand the existing architecture.
2. Check whether the feature already exists.
3. Reuse existing abstractions.
4. Avoid unnecessary dependencies.
5. Implement the smallest clean solution.
6. Test edge cases.
7. Verify mobile and desktop behavior.

Do not rewrite the project or introduce infrastructure without a clear reason.

## Quality Standard

The application should feel like a mature utility product:

- Minimal
- Fast
- Clear
- Predictable
- Functional
- Accessible
- Responsive
- Maintainable

Avoid:

- Gradients everywhere
- Glassmorphism
- Glow
- Excessive rounded cards
- Excessive shadows
- Decorative dashboards
- Unnecessary animations
- Fake data
- Over-engineering