import { defaultDataset } from "../domain/defaults";
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
 *
 * Data safety — hydration gate: every repository used by the store may load
 * asynchronously (IndexedDB / Supabase). Until that load has settled the
 * in-memory dataset is only the empty default, so persisting a write at that
 * moment would overwrite the real stored data (the guest refresh data-loss
 * bug). To prevent that, writes issued before hydration are queued and
 * replayed on top of the loaded dataset instead of being written blind.
 */

type PendingOp =
  | { kind: "update"; mutate: (draft: Dataset) => void }
  | { kind: "replace"; dataset: Dataset }
  | { kind: "reset" };

export class Store {
  private dataset: Dataset;
  private readonly listeners = new Set<() => void>();
  private readonly initialReady: Promise<void>;
  private repository: Repository;
  /** True once `dataset` reflects the active repository's persisted data. */
  private hydrated = false;
  /** Writes issued before hydration — replayed on top of the loaded data. */
  private pending: PendingOp[] = [];
  private draining = false;

  constructor(repository: Repository = createDefaultRepository()) {
    this.repository = repository;
    // Provisional snapshot. For async backends this is the empty default
    // until hydrate() adopts the stored dataset.
    this.dataset = repository.load();
    this.initialReady = this.hydrate(repository);
  }

  /** Resolves once the ACTIVE backend's initial async load has settled AND
   * the in-memory dataset reflects it. */
  ready(): Promise<void> {
    return this.initialReady;
  }

  /**
   * Adopts the repository's asynchronously loaded dataset. Writes that
   * arrived before the load settled are replayed on top of it, so a boot-time
   * write can never overwrite persisted data with the empty default.
   */
  private hydrate(repository: Repository): Promise<void> {
    // SyncRepositoryAdapter exposes the background IndexedDB/Supabase load;
    // a plain synchronous repository (localStorage/memory) has none and its
    // constructor load() is already final.
    const initial = repository.initialLoad?.();
    if (!initial) {
      this.hydrated = true;
      return Promise.resolve();
    }
    return initial
      .catch(() => undefined)
      .then(() => {
        // A setRepository() swap already adopted the new backend — never
        // clobber it with this one's (stale) load.
        if (this.repository !== repository) return;
        this.dataset = repository.load();
        this.hydrated = true;
        if (this.pending.length > 0) {
          this.flushPending();
        } else {
          this.notify();
        }
      });
  }

  /** Current dataset snapshot. Do not mutate it directly — use update(). */
  get(): Dataset {
    return this.dataset;
  }

  /** Applies `mutate` to a clone, persists it, and notifies listeners.
   * Before hydration the mutation is queued so it is applied to the loaded
   * dataset rather than persisting the empty default over it. */
  update(mutate: (draft: Dataset) => void): void {
    if (!this.hydrated) {
      this.pending.push({ kind: "update", mutate });
      return;
    }
    this.applyUpdate(mutate);
  }

  /** Replaces the whole dataset (used by import in Phase 10) and persists. */
  replace(dataset: Dataset): void {
    if (!this.hydrated) {
      this.pending.push({ kind: "replace", dataset });
      return;
    }
    this.dataset = dataset;
    this.repository.save(this.dataset);
    this.notify();
  }

  /** Discards all data and restores the default dataset. */
  reset(): void {
    if (!this.hydrated) {
      this.pending.push({ kind: "reset" });
      return;
    }
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
    this.hydrated = true;
    if (this.pending.length > 0) {
      // Replay writes that were queued before hydration on the new backend.
      this.flushPending();
    } else {
      this.notify();
    }
    return true;
  }

  /** Registers a change listener; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private applyUpdate(mutate: (draft: Dataset) => void): void {
    const draft: Dataset = structuredClone(this.dataset);
    mutate(draft);
    this.dataset = draft;
    this.repository.save(this.dataset);
    this.notify();
  }

  /** Replays queued pre-hydration writes in order with a single persist. */
  private flushPending(): void {
    if (!this.hydrated || this.draining || this.pending.length === 0) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const op = this.pending.shift();
        if (!op) break;
        if (op.kind === "update") {
          const draft: Dataset = structuredClone(this.dataset);
          op.mutate(draft);
          this.dataset = draft;
        } else if (op.kind === "replace") {
          this.dataset = op.dataset;
        } else {
          this.repository.clear();
          this.dataset = defaultDataset();
        }
      }
      this.repository.save(this.dataset);
      this.notify();
    } finally {
      this.draining = false;
    }
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
