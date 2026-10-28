import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_SNAPSHOT_VERSION,
  SNAPSHOT_KEY_PREFIX,
  SNAPSHOT_TTL_MS,
  clearSnapshot,
  loadSnapshot,
  readSnapshotMeta,
  saveSnapshot,
  serializeSnapshot,
  shouldPersistQuery,
} from "@/lib/pwa/offlineSnapshot";
import { APP_VERSION } from "@/lib/roadmap";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function seededClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["events", 1, 2], [{ id: "event-1" }]);
  client.setQueryData(["tasks", "all", null, "open"], { tasks: [], counts: {} });
  client.setQueryData(["collections"], [{ id: "collection-1" }]);
  client.setQueryData(["preferences"], { timeFormat: "24h" });
  client.setQueryData(["events", "search", "class"], [{ id: "search-hit" }]);
  client.setQueryData(["import-batches"], [{ id: "batch-1" }]);
  return client;
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

describe("offline snapshot allowlist", () => {
  it("accepts the four data roots and rejects search and import data", () => {
    expect(shouldPersistQuery({ queryKey: ["events", 1, 2] })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["tasks", "counts"] })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["collections"] })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["preferences"] })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["events", "search", "class"] })).toBe(false);
    expect(shouldPersistQuery({ queryKey: ["import-batches"] })).toBe(false);
    expect(shouldPersistQuery({ queryKey: ["something-else"] })).toBe(false);
  });

  it("dehydrates only successful allowlisted queries", () => {
    const client = seededClient();
    const snapshot = serializeSnapshot(client, 1_000);
    const keys = snapshot.state.queries.map((query) => query.queryKey);
    expect(keys).toContainEqual(["events", 1, 2]);
    expect(keys).toContainEqual(["tasks", "all", null, "open"]);
    expect(keys).toContainEqual(["collections"]);
    expect(keys).toContainEqual(["preferences"]);
    expect(keys).not.toContainEqual(["events", "search", "class"]);
    expect(keys).not.toContainEqual(["import-batches"]);
  });
});

describe("offline snapshot persistence", () => {
  it("round-trips a snapshot with its saved time", () => {
    const snapshot = serializeSnapshot(seededClient(), 5_000);
    expect(saveSnapshot("user-a", snapshot)).toBe(true);
    const loaded = loadSnapshot("user-a", 6_000);
    expect(loaded?.savedAt).toBe(5_000);
    expect(loaded?.appVersion).toBe(APP_VERSION);
    expect(loaded?.version).toBe(OFFLINE_SNAPSHOT_VERSION);
    expect(readSnapshotMeta("user-a")).toEqual({ savedAt: 5_000 });
  });

  it("ignores an expired snapshot", () => {
    const snapshot = serializeSnapshot(seededClient(), 1_000);
    saveSnapshot("user-a", snapshot);
    expect(loadSnapshot("user-a", 1_000 + SNAPSHOT_TTL_MS + 1)).toBeNull();
  });

  it("ignores a snapshot from another user or app version", () => {
    saveSnapshot("user-a", serializeSnapshot(seededClient(), 1_000));
    expect(loadSnapshot("user-b", 1_000)).toBeNull();

    const wrongVersion = serializeSnapshot(seededClient(), 1_000);
    wrongVersion.appVersion = "0.0.0";
    saveSnapshot("user-c", wrongVersion);
    expect(loadSnapshot("user-c", 1_000)).toBeNull();

    const wrongShape = serializeSnapshot(seededClient(), 1_000);
    wrongShape.version = OFFLINE_SNAPSHOT_VERSION + 1;
    saveSnapshot("user-d", wrongShape);
    expect(loadSnapshot("user-d", 1_000)).toBeNull();
  });

  it("survives a full or blocked storage by returning false and clearing", () => {
    saveSnapshot("user-a", serializeSnapshot(seededClient(), 1_000));
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(saveSnapshot("user-a", serializeSnapshot(seededClient(), 2_000))).toBe(false);
    expect(storage.getItem(`${SNAPSHOT_KEY_PREFIX}user-a`)).toBeNull();
  });

  it("clears one user's snapshot or all of them", () => {
    saveSnapshot("user-a", serializeSnapshot(seededClient(), 1_000));
    saveSnapshot("user-b", serializeSnapshot(seededClient(), 1_000));
    clearSnapshot("user-a");
    expect(loadSnapshot("user-a", 1_000)).toBeNull();
    expect(loadSnapshot("user-b", 1_000)).not.toBeNull();
    clearSnapshot();
    expect(loadSnapshot("user-b", 1_000)).toBeNull();
  });
});
