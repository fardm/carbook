import type { Dataset } from "../domain/types";
import { browserStorage, createRepository, type Repository } from "../persistence/repository";

/**
 * Minimal in-memory store: holds the dataset, persists every change through
 * the repository, and notifies subscribers so views can re-render.
 *
 * Rendering strategy: views subscribe and re-render (fully) on change — this
 * is a personal utility, not a stateful framework app.
 */
export class Store {
  private dataset: Dataset;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly repository: Repository = createRepository(browserStorage())) {
    this.dataset = repository.load();
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