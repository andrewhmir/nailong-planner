import { dehydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { APP_VERSION } from "@/lib/roadmap";

/** Bump when the stored shape changes; older snapshots are then ignored. */
export const OFFLINE_SNAPSHOT_VERSION = 1;
/** Saved reads older than this are not replayed on an offline launch. */
export const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SNAPSHOT_KEY_PREFIX = "nailong.offline.";

/** Query roots that are safe and useful to keep read-only offline. */
const PERSISTED_ROOTS = new Set(["events", "tasks", "collections", "preferences"]);

export interface OfflineSnapshot {
  version: number;
  appVersion: string;
  savedAt: number;
  state: DehydratedState;
}

/**
 * The read-only allowlist. Search results and import-batch data are never kept
 * on disk, and anything outside the four data roots is left to the network.
 */
export function shouldPersistQuery(query: { queryKey: readonly unknown[] }): boolean {
  const root = query.queryKey[0];
  if (typeof root !== "string" || !PERSISTED_ROOTS.has(root)) {
    return false;
  }
  return !query.queryKey.includes("search");
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can throw in private browsing or when blocked by policy.
    return null;
  }
}

function snapshotKey(userId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${userId}`;
}

/** Dehydrate the allowlisted, successfully loaded queries for the current user. */
export function serializeSnapshot(
  queryClient: QueryClient,
  now: number = Date.now(),
): OfflineSnapshot {
  return {
    version: OFFLINE_SNAPSHOT_VERSION,
    appVersion: APP_VERSION,
    savedAt: now,
    state: dehydrate(queryClient, {
      shouldDehydrateQuery: (query) =>
        query.state.status === "success" && shouldPersistQuery(query),
    }),
  };
}

/** Persist a snapshot. Returns false (and clears the key) on quota/blocked storage. */
export function saveSnapshot(userId: string, snapshot: OfflineSnapshot): boolean {
  const store = safeStorage();
  if (!store) {
    return false;
  }
  try {
    store.setItem(snapshotKey(userId), JSON.stringify(snapshot));
    return true;
  } catch {
    try {
      store.removeItem(snapshotKey(userId));
    } catch {
      // Nothing else to do: the app keeps working online.
    }
    return false;
  }
}

/**
 * Read this user's snapshot, or null when it is missing, malformed, from a
 * different app version/shape, or older than the TTL.
 */
export function loadSnapshot(userId: string, now: number = Date.now()): OfflineSnapshot | null {
  const store = safeStorage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(snapshotKey(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<OfflineSnapshot> | null;
    const state = parsed?.state as { queries?: unknown } | undefined;
    if (
      !parsed ||
      parsed.version !== OFFLINE_SNAPSHOT_VERSION ||
      parsed.appVersion !== APP_VERSION ||
      typeof parsed.savedAt !== "number" ||
      !state ||
      !Array.isArray(state.queries) ||
      now - parsed.savedAt > SNAPSHOT_TTL_MS
    ) {
      return null;
    }
    return parsed as OfflineSnapshot;
  } catch {
    return null;
  }
}

/** The banner's "last saved" time; null when there is no usable snapshot. */
export function readSnapshotMeta(userId: string): { savedAt: number } | null {
  const snapshot = loadSnapshot(userId);
  return snapshot ? { savedAt: snapshot.savedAt } : null;
}

/** Remove one user's snapshot, or every snapshot on this device when omitted. */
export function clearSnapshot(userId?: string): void {
  const store = safeStorage();
  if (!store) {
    return;
  }
  try {
    if (userId) {
      store.removeItem(snapshotKey(userId));
      return;
    }
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(SNAPSHOT_KEY_PREFIX)) {
        store.removeItem(key);
      }
    }
  } catch {
    // Best effort: the query client is cleared by the sign-out handler anyway.
  }
}
