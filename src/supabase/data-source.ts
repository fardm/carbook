import { store } from "../state/store";
import {
  createDefaultRepository,
  SyncRepositoryAdapter,
  type Repository,
} from "../persistence/repository";
import { auth } from "./auth";
import { getSupabase } from "./client";
import { SupabaseRepository } from "./repository";

/**
 * Centralized data source — the ONLY place in the app that decides which
 * persistence backend is active:
 *
 *   if authenticated  →  SupabaseRepository (user's own rows, RLS-scoped)
 *   else (guest)      →  existing IndexedDB repository (untouched behavior)
 *
 * UI components never see or choose the backend; they use the store as
 * before. This module listens to auth transitions and swaps the store's
 * repository at exactly the right moments, so the UI can never display the
 * previous user's cloud data in guest mode (or vice versa).
 *
 * There is NO continuous IndexedDB ↔ Supabase synchronization: each mode
 * has exactly one source of truth (IndexedDB for guests, Supabase for
 * authenticated users), and switching modes swaps repositories atomically.
 */

/** The guest repository is a process-wide singleton (IndexedDB). */
let guestRepository: Repository | null = null;

function getGuestRepository(): Repository {
  if (!guestRepository) {
    guestRepository = createDefaultRepository();
  }
  return guestRepository;
}

function repositoryForUser(userId: string): Repository | null {
  const client = getSupabase();
  if (!client) return null;
  // The cloud repository is async; wrap it in the same synchronous adapter
  // the guest IndexedDB repository uses, so the store keeps ONE interface.
  return new SyncRepositoryAdapter(new SupabaseRepository(client, userId));
}

/* Backend swaps are serialized through a promise chain so rapid auth
 * transitions (login → logout in quick succession) can never interleave
 * half-finished repository swaps. */
let swapChain: Promise<void> = Promise.resolve();

/** Auth state already applied to the store (undefined = nothing yet). */
let lastAppliedUserId: string | null | undefined = undefined;

/**
 * Boots the data layer: initializes auth state (which resolves the persisted
 * Supabase session from localStorage), then applies the correct repository
 * for the restored session. Views must await this before their first data
 * read (main.ts does).
 *
 * Ordering: the auth-event subscription is registered BEFORE the initial
 * apply, and both funnel through the same serialized swap chain. So if a
 * login/logout event arrives while the initial swap is still in flight, it
 * is queued behind it instead of being lost — the first decision about the
 * active backend always happens after auth state is final.
 */
export async function initializeDataSource(): Promise<void> {
  await auth.initialize();
  // Subsequent login/logout transitions swap the backend immediately.
  auth.subscribe(() => {
    void applyAuthState();
  });
  await applyAuthState();
}

/**
 * Applies the backend matching the CURRENT auth state:
 *   - authenticated → swap the store to that user's Supabase repository;
 *   - guest → swap back to the guest IndexedDB repository.
 * Idempotent per user (TOKEN_REFRESHED etc. are no-ops). After logout the
 * in-memory dataset comes from IndexedDB only — no cloud row is ever copied
 * into guest storage.
 */
export function applyAuthState(): Promise<void> {
  const next = swapChain.then(applyAuthStateInner);
  swapChain = next.catch(() => undefined);
  return next;
}

async function applyAuthStateInner(): Promise<void> {
  const user = auth.getUser();
  // Same backend already active (e.g. periodic TOKEN_REFRESHED) → no-op.
  // `undefined` means NOTHING was applied yet and must never match the
  // guest state (null): treating "no decision made" as "guest active"
  // would skip the initial guest bind and let a stale dataset survive a
  // repository swap.
  if (user?.id != null && user.id === lastAppliedUserId) return;
  if (user == null && lastAppliedUserId === null) return;
  if (user) {
    const cloudRepository = repositoryForUser(user.id);
    if (!cloudRepository) return; // no Supabase env — stay in guest mode
    lastAppliedUserId = user.id;
    await store.setRepository(cloudRepository);
    return;
  }
  // Guest mode: flush any queued local writes first, then re-bind to the
  // (untouched) guest repository.
  lastAppliedUserId = null;
  const guest = getGuestRepository();
  await guest.flush?.();
  await store.setRepository(guest);
}

/**
 * Forces a fresh load from the backend matching the current auth state.
 * Used after the guest→cloud migration so the just-uploaded rows appear
 * without waiting for a new auth event.
 */
export async function reloadActiveRepository(): Promise<void> {
  const next = swapChain.then(reloadActiveRepositoryInner);
  swapChain = next.catch(() => undefined);
  return next;
}

async function reloadActiveRepositoryInner(): Promise<void> {
  const user = auth.getUser();
  if (user) {
    const cloudRepository = repositoryForUser(user.id);
    if (cloudRepository) {
      lastAppliedUserId = user.id;
      await store.setRepository(cloudRepository);
      return;
    }
  }
  lastAppliedUserId = null;
  const guest = getGuestRepository();
  await guest.flush?.();
  await store.setRepository(guest);
}

/** The active guest repository (used by the migration flow). */
export function currentGuestRepository(): Repository {
  return getGuestRepository();
}

/** Test hook: forget applied state + guest singleton between tests. */
export function resetDataSourceForTests(): void {
  guestRepository = null;
  lastAppliedUserId = undefined;
  swapChain = Promise.resolve();
}
