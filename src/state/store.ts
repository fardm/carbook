import type { Dataset } from "../domain/types";
import { createDefaultRepository, type Repository } from "../persistence/repository";

/**
 * Minimal in-memory store: holds the dataset, persists every change through
 * the repository, and notifies subscribers so views can re-render.
 *
 * Rendering strategy: views subscribe and re-render (fully) on change — this
 * is a personal utility, not a stateful framework app.
 *
 * Backend swap (accounts): the repository is normally fixed for the store's
 * lifetime, but logging in/out must move the store between the guest
 * IndexedDB backend and the user's Supabase backend. `setRepository()`
 * re-binds the backend atomically (cache swapped before any async load,
 * notify exactly once at the end) so no render can ever observe the dataset
 * of the other backend. `ready()` completes only after the ACTIVE backend's
 * initial load has settled, so boot never renders one backend's data for
 * another's.
 */
export class Store {
  private dataset: Dataset;
  private readonly listeners = new Set<() => void>();
  private readonly initialReady: Promise<void>;
  private repository: Repository;

  constructor(repository: Repository = createDefaultRepository()) {
    this.repository = repository;
    this.dataset = repository.load();
    this.initialReady = this.awaitInitialLoad(repository);
  }

  /** Resolves once the ACTIVE backend's initial async load has settled. */
  ready(): Promise<void> {
    return this.initialReady;
  }

  private awaitInitialLoad(repository: Repository): Promise<void> {
    // SyncRepositoryAdapter: wait for its background IndexedDB load.
    const initial = repository.initialLoad?.();
    if (initial) return initial;
    // Plain sync repository: load() already ran in the constructor.
    return Promise.resolve();
  }

  /** Current dataset snapshot. Do not mutate it directly — use update(). */
  get(): Dataset {
    return this.dataset;
  }

  /** Applies `mutate` to a clone, persists it, and notifies listeners. */
  update(mutate: (draft: Dataset) => void): void {
    const draft: Dataset = structuredClone(this.dataset);
    mutate(draft);
    this.dataset = draft;
    this.repository.save(this.dataset);
    this.notify();
  }

  /** Replaces the whole dataset (used by import in Phase 10) and persists. */
  replace(dataset: Dataset): void {
    this.dataset = dataset;
    this.repository.save(this.dataset);
    this.notify();
  }

  /** Discards all data and restores the default dataset. */
  reset(): void {
    this.repository.clear();
    this.dataset = this.repository.load();
    this.notify();
  }

  /**
   * Re-binds the persistence backend in one atomic step and returns true on
   * success, false if the new backend's initial load failed (the old backend
   * is kept active in that case to prevent data loss).
   *
   * Steps (ordered so no cross-backend leak is observable):
   *  1. await the NEW backend's initial load first (the old backend stays
   *     active during this window so any store.update() triggered by
   *     visibilitychange, reminders, etc. still writes to the OLD repo);
   *  2. if the load failed, bail out — the old backend stays active;
   *  3. swap both repository AND dataset atomically — no window where the
   *     store points at the new backend with stale/empty data;
   *  4. notify exactly once at the end — listeners re-render the new data.
   */
  async setRepository(repository: Repository): Promise<boolean> {
    // Let the new repository's own initial-load promise settle (the Supabase
    // adapter's load IS its background fetch) BEFORE swapping the backend.
    const initial = repository.initialLoad?.();
    if (initial) {
      let failed = false;
      await initial.catch(() => { failed = true; });
      if (failed) return false;
    }
    this.repository = repository;
    this.dataset = repository.load();
    this.notify();
    return true;
  }

  /** Registers a change listener; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Application-wide store. Created lazily-safe: browserStorage() falls back
 * to in-memory outside the browser, so importing this module is side-effect
 * free in tests and node contexts. */
export const store = new Store();