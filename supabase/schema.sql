-- ============================================================================
-- CarBook — Supabase schema (accounts + cloud persistence)
--
-- The schema mirrors the app's ACTUAL Dataset data model 1:1 (see
-- src/domain/types.ts): vehicles, maintenance_items, service_history,
-- reminders, app_settings. No parallel or simplified model.
--
-- Rules enforced here:
--   * Every table is user-owned: user_id uuid references auth.users(id).
--   * RLS is ENABLED and FORCEd on every table (forced = even table owners
--     cannot bypass the policies).
--   * Users can SELECT/INSERT/UPDATE/DELETE only their own rows.
--   * INSERT is additionally guarded by WITH CHECK (user_id = auth.uid()),
--     so a user can never insert a row belonging to someone else.
--   * The frontend uses ONLY the publishable (anon) key — never the
--     service-role key — so RLS always applies.
--
-- Run once in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------
create table if not exists public.vehicles (
  id                      uuid primary key,
  user_id                 uuid not null references auth.users (id) on delete cascade,
  name                    text not null,
  make                    text not null default '',
  model                   text not null default '',
  year                    numeric,
  fuel_type               text,
  average_annual_distance numeric,
  current_odometer        numeric,
  odometer_updated_at     timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- maintenance_items  (MaintenanceItem; rule fields are flattened)
-- ---------------------------------------------------------------------------
create table if not exists public.maintenance_items (
  id              uuid primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  vehicle_id      uuid references public.vehicles (id) on delete cascade,
  catalog_id      text,
  name            text not null,
  category        text not null,
  icon            text not null,
  interval_km     numeric,
  interval_months numeric,
  trigger         text not null default 'any',
  display_mode    text not null default 'auto',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- service_history  (ServiceRecord)
-- ---------------------------------------------------------------------------
create table if not exists public.service_history (
  id                  uuid primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  maintenance_item_id uuid not null references public.maintenance_items (id) on delete cascade,
  vehicle_id          uuid references public.vehicles (id) on delete cascade,
  date                date not null,
  odometer            numeric,
  notes               text not null default '',
  cost                numeric,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reminders  (Reminder; notificationOffsets kept as jsonb — a list of at
-- most one {days}/{km} object per kind, exactly as the app models it)
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id                    uuid primary key,
  user_id               uuid not null references auth.users (id) on delete cascade,
  vehicle_id            uuid not null references public.vehicles (id) on delete cascade,
  title                 text not null,
  description           text not null default '',
  service_id            uuid references public.maintenance_items (id) on delete set null,
  sync_with_service     boolean not null default false,
  type                  text not null default 'date',
  due_date              date,
  due_mileage           numeric,
  notification_offsets  jsonb not null default '[]'::jsonb,
  repeat                text not null default 'none',
  repeat_weekday        numeric,
  repeat_every_km       numeric,
  enabled               boolean not null default true,
  last_completed_date   date,
  last_completed_mileage numeric,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- app_settings  (Settings — one row per user, keyed by user_id)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  due_soon_percent   numeric not null default 20,
  due_percent        numeric not null default 5,
  theme              text not null default 'system',
  calendar           text not null default 'jalali',
  currency           text not null default 'IRR',
  default_vehicle_id uuid references public.vehicles (id) on delete set null,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: predictable policy names + ownership predicates
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select * from unnest(array['vehicles', 'maintenance_items', 'service_history', 'reminders', 'app_settings'])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);

    if t <> 'app_settings' then
      execute format($p$
        create policy %I on public.%I
          for select to authenticated
          using (user_id = auth.uid());
      $p$, t || '_select_own', t);
      execute format($p$
        create policy %I on public.%I
          for insert to authenticated
          with check (user_id = auth.uid());
      $p$, t || '_insert_own', t);
      execute format($p$
        create policy %I on public.%I
          for update to authenticated
          using (user_id = auth.uid())
          with check (user_id = auth.uid());
      $p$, t || '_update_own', t);
      execute format($p$
        create policy %I on public.%I
          for delete to authenticated
          using (user_id = auth.uid());
      $p$, t || '_delete_own', t);
    else
      -- app_settings is keyed by user_id (its primary key).
      execute format($p$
        create policy %I on public.%I
          for all to authenticated
          using (user_id = auth.uid())
          with check (user_id = auth.uid());
      $p$, t || '_all_own', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Indexes (per-user access patterns)
-- ---------------------------------------------------------------------------
create index if not exists vehicles_user_id_idx            on public.vehicles (user_id);
create index if not exists maintenance_items_user_id_idx   on public.maintenance_items (user_id);
create index if not exists service_history_user_id_idx     on public.service_history (user_id);
create index if not exists reminders_user_id_idx           on public.reminders (user_id);
