import type { CollectionRow } from "@/lib/db/schema";

export type GroupKey = "ours" | "me" | "partner";

export interface VisibilityState {
  /** The three person pills. */
  groups: Record<GroupKey, boolean>;
  /** Per-collection checkbox overrides; missing means visible. */
  collections: Record<string, boolean>;
  /**
   * Google Calendar's "display only this calendar", kept separate from the
   * checkboxes so leaving the view restores them untouched. While set, only
   * this collection is drawn and new events default to it.
   */
  only: string | null;
}

export const GROUP_ORDER: readonly GroupKey[] = ["ours", "me", "partner"];

export const DEFAULT_VISIBILITY: VisibilityState = {
  groups: { ours: true, me: true, partner: true },
  collections: {},
  only: null,
};

/** Only real booleans survive: a corrupt stored value must not hide a row. */
function booleanEntries(value: unknown): Record<string, boolean> {
  const entries: Record<string, boolean> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return entries;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "boolean") {
      entries[key] = entry;
    }
  }
  return entries;
}

/**
 * Reads the persisted visibility state, falling back to everything visible.
 * The storage key is unchanged across the collection rename; a pre-v0.2 JSON
 * body carries a `calendars` map instead of `collections`, which is not a known
 * key and therefore reads as "no per-collection overrides".
 */
export function parseVisibility(raw: string | null): VisibilityState {
  if (!raw) {
    return DEFAULT_VISIBILITY;
  }
  try {
    const parsed = JSON.parse(raw) as {
      groups?: unknown;
      collections?: unknown;
      only?: unknown;
    } | null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_VISIBILITY;
    }
    return {
      groups: {
        ...DEFAULT_VISIBILITY.groups,
        ...(booleanEntries(parsed.groups) as Partial<Record<GroupKey, boolean>>),
      },
      collections: booleanEntries(parsed.collections),
      only: typeof parsed.only === "string" ? parsed.only : null,
    };
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

/**
 * The owner that actually applies to a collection. A sub-collection inherits
 * its root's owner — the server folds the same way in `getCollectionAccess` —
 * so a stale per-row `ownerId` on a child must not decide its group.
 */
export function effectiveOwnerOf(
  collection: Pick<CollectionRow, "ownerId">,
  parent?: Pick<CollectionRow, "ownerId"> | null,
): string | null {
  return parent ? (parent.ownerId ?? collection.ownerId) : collection.ownerId;
}

export function groupOf(
  collection: Pick<CollectionRow, "ownerId">,
  viewerId: string,
  parent?: Pick<CollectionRow, "ownerId"> | null,
): GroupKey {
  const ownerId = effectiveOwnerOf(collection, parent);
  if (ownerId === null) {
    return "ours";
  }
  return ownerId === viewerId ? "me" : "partner";
}

/**
 * A collection is drawn only when its person pill, its parent's checkbox and
 * its own checkbox all agree. This is what makes the pills a one-click
 * cross-check while individual collections stay independently togglable.
 *
 * "Display only this calendar" outranks all of that: exactly the chosen
 * collection is drawn, so a parent's sub-collections stay hidden until one of
 * them is isolated in turn.
 */
export function isCollectionVisible(
  state: VisibilityState,
  collection: Pick<CollectionRow, "id" | "ownerId">,
  viewerId: string,
  parent?: Pick<CollectionRow, "id" | "ownerId"> | null,
): boolean {
  if (state.only !== null) {
    return collection.id === state.only;
  }
  if (!(state.groups[groupOf(collection, viewerId, parent)] ?? true)) {
    return false;
  }
  if (parent && (state.collections[parent.id] ?? true) === false) {
    return false;
  }
  return state.collections[collection.id] ?? true;
}
