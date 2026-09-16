# CarBook

CarBook (کاربوک) is a modern, digital vehicle maintenance and service log (PWA) designed to track vehicle upkeep, service records, consumable part health, and periodic maintenance reminders.

## Features

- **Vehicle Management**: Track multiple vehicles with odometer and mileage records.
- **Service History**: Log maintenance and repair entries with dates, costs, and notes.
- **Part Health & Lifetime Tracking**: Monitor consumable part wear and estimate remaining lifespan based on distance or time.
- **Maintenance Reminders**: Scheduled reminders for upcoming periodic services and part replacements.
- **Local & Online Data Storage**: Use offline as a guest or sign in for cloud storage.
- **PWA Support**: Installable Progressive Web App with offline caching via Service Worker.
- **Blog**: Content section with Markdown rendering, categories, and dynamic sitemap generation.

## Architecture

- **Programming Language**: TypeScript (ES Modules)
- **Build & Tooling**: Vite, TypeScript (`tsc`), Vitest
- **Frontend Architecture**: Vanilla TypeScript and DOM (framework-free), reactive state store, client-side hash routing for the app (`/app`), and multi-page routing for public and blog pages
- **Styling**: Vanilla CSS with Material Design 3 design tokens and responsive Persian RTL support
- **Database**:
  - *Local*: Browser IndexedDB (versioned dataset repository with JSON import/export)
  - *Cloud*: PostgreSQL hosted on Supabase with Row Level Security (RLS)
- **Authentication**: Supabase Auth (Email/Password and Google OAuth with PKCE flow)
- **Hosting & Deployment**: GitHub Pages with automated builds via GitHub Actions
- **Services**: Supabase (`@supabase/supabase-js`) for cloud auth and database; Service Worker for PWA asset caching

## Data Storage

CarBook operates with two distinct storage modes:

- **Guest / Local Mode**: Data is stored exclusively in the browser using IndexedDB. No account or internet connection is required, and data never leaves the device.
- **Authenticated Mode**: User data is stored online in Supabase PostgreSQL, scoped to the user ID and protected by Row Level Security (RLS).

**Important Distinction**: There is no continuous two-way sync between IndexedDB and Supabase. Each mode maintains a single source of truth (IndexedDB for guests, Supabase for authenticated users), and switching modes swaps repositories atomically. When a guest with local records signs into an empty account, an optional one-time migration can transfer local data to the cloud while preserving the local copy.