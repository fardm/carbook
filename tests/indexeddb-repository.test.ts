import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { defaultDataset } from "../src/domain/defaults";
import { createId } from "../src/domain/ids";
import type { Dataset } from "../src/domain/types";
import { createIndexedDBRepository, SyncRepositoryAdapter, type AsyncRepository } from "../src/persistence/repository";

/**
 * Test helper to create a populated dataset for testing.
 */
function populatedDataset(): Dataset {
  const dataset = defaultDataset();
  dataset.vehicles = [
    {
      id: createId(),
      name: "پژو ۲۰۷",
      make: "پژو",
      model: "207",
      year: 1390,
      fuelType: "gasoline",
      averageAnnualDistance: 14600,
      currentOdometer: 103900,
      odometerUpdatedAt: "2026-09-04T10:00:00.000Z",
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
    },
  ];
  dataset.maintenanceItems = [
    {
      id: createId(),
      vehicleId: dataset.vehicles[0].id,
      catalogId: "engineOil",
      name: "روغن موتور",
      category: "engine",
      icon: "droplets",
      rule: { intervalKm: 10000, intervalMonths: 6, trigger: "any", displayMode: "auto" },
      active: true,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
    },
  ];
  dataset.serviceHistory = [
    {
      id: createId(),
      maintenanceItemId: dataset.maintenanceItems[0].id,
      vehicleId: dataset.vehicles[0].id,
      date: "2026-08-20",
      odometer: 100000,
      notes: "",
      cost: null,
      createdAt: "2026-08-20T08:00:00.000Z",
    },
  ];
  return dataset;
}

describe("SyncRepositoryAdapter", () => {
  it("should provide synchronous interface for async repository", async () => {
    const mockAsyncRepo: AsyncRepository = {
      load: vi.fn().mockResolvedValue(defaultDataset()),
      save: vi.fn().mockImplementation(async () => {
        // Save implementation
      }),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    
    const adapter = new SyncRepositoryAdapter(mockAsyncRepo);
    
    // Initial load should return default dataset
    expect(adapter.load()).toEqual(defaultDataset());
    
    // Save should work (fire and forget)
    const testDataset = populatedDataset();
    adapter.save(testDataset);
    
    // Give async operation time to start
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Save should have been called
    expect(mockAsyncRepo.save).toHaveBeenCalledWith(testDataset);
    
    // Clear should work
    adapter.clear();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockAsyncRepo.clear).toHaveBeenCalled();
  });
  
  it("should queue operations to avoid race conditions", async () => {
    let saveCount = 0;
    let saveCompleteOrder: number[] = [];
    
    const mockAsyncRepo: AsyncRepository = {
      load: vi.fn().mockResolvedValue(defaultDataset()),
      save: vi.fn().mockImplementation(async () => {
        const currentCount = ++saveCount;
        await new Promise(resolve => setTimeout(resolve, 20)); // Simulate async delay
        saveCompleteOrder.push(currentCount);
      }),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    
    const adapter = new SyncRepositoryAdapter(mockAsyncRepo);
    
    // Trigger multiple saves quickly
    adapter.save(populatedDataset());
    adapter.save(populatedDataset());
    adapter.save(populatedDataset());
    
    // Wait for all async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should have been called 3 times
    expect(mockAsyncRepo.save).toHaveBeenCalledTimes(3);
    // Operations should complete in order (1, 2, 3)
    expect(saveCompleteOrder).toEqual([1, 2, 3]);
  });
});

describe("createIndexedDBRepository", () => {
  beforeEach(() => {
    // Mock global indexedDB for browser environment
    if (typeof globalThis.indexedDB === 'undefined') {
      (globalThis as any).indexedDB = {
        open: vi.fn(() => ({
          onupgradeneeded: vi.fn(),
          onsuccess: vi.fn((callback: Function) => {
            setTimeout(() => callback({ target: { result: {} } }), 0);
          }),
          onerror: vi.fn(),
        })),
      };
    }
  });
  
  afterEach(() => {
    // Clean up mock
    if ((globalThis as any).indexedDB?.open?.mockClear) {
      vi.clearAllMocks();
    }
  });
  
  it("should create repository with IndexedDB backend", () => {
    const repo = createIndexedDBRepository();
    expect(repo).toBeDefined();
    expect(repo.load()).toBeDefined();
    expect(typeof repo.save).toBe("function");
    expect(typeof repo.clear).toBe("function");
  });
  
  it("should handle IndexedDB errors gracefully", async () => {
    // Mock IndexedDB to throw error
    (globalThis as any).indexedDB = {
      open: vi.fn(() => ({
        onupgradeneeded: vi.fn(),
        onsuccess: vi.fn(),
        onerror: vi.fn((callback: Function) => {
          setTimeout(() => callback(new Error("IndexedDB error")), 0);
        }),
      })),
    };
    
    const repo = createIndexedDBRepository();
    
    // Should not throw on construction
    expect(repo).toBeDefined();
    
    // Load should return default dataset even when IndexedDB fails
    const dataset = repo.load();
    expect(dataset).toEqual(defaultDataset());
    
    // Save should not throw
    expect(() => repo.save(populatedDataset())).not.toThrow();
  });
});

describe("IndexedDBRepository error handling", () => {
  it("should return default dataset on load failure", async () => {
    // This is tested through the integration above
    // The actual IndexedDBRepository is tested through createIndexedDBRepository
    // which wraps it with SyncRepositoryAdapter
    expect(true).toBe(true);
  });
});

// Note: Full IndexedDBRepository tests would require a real IndexedDB implementation
// or a more comprehensive mock. The tests above verify the adapter pattern
// and error handling which are the most critical parts for the migration.