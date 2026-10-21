import type { GroupKey } from "@/lib/ui/visibility";

/**
 * Sidebar fold state. Folding is display-only: it hides a branch in the
 * calendar tree but never changes which calendars are drawn on the grid — that
 * is `VisibilityState`'s job (`lib/ui/visibility.ts`).
 *
 * `true` means expanded, and a missing entry means expanded, so a tree that has
 * never been folded looks exactly like it did before folding existed.
 */
export interface TreeFoldState {
  groups: Record<GroupKey, boolean>;
  /** Per-root-calendar overrides; children fold with their root. */
  calendars: Record<string, boolean>;
}

export const DEFAULT_TREE_FOLD: TreeFoldState = {
  groups: { ours: true, me: true, partner: true },
  calendars: {},
};

export function isGroupOpen(state: TreeFoldState, group: GroupKey): boolean {
  return state.groups[group] ?? true;
}

export function isCalendarOpen(state: TreeFoldState, id: string): boolean {
  return state.calendars[id] ?? true;
}

export function setGroupOpen(state: TreeFoldState, group: GroupKey, open: boolean): TreeFoldState {
  return { ...state, groups: { ...state.groups, [group]: open } };
}

export function setCalendarOpen(state: TreeFoldState, id: string, open: boolean): TreeFoldState {
  return { ...state, calendars: { ...state.calendars, [id]: open } };
}

/** Only real booleans survive: a corrupt stored value must not fold a branch. */
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

/** Reads the persisted fold state, falling back to everything expanded. */
export function parseTreeFold(raw: string | null): TreeFoldState {
  if (!raw) {
    return DEFAULT_TREE_FOLD;
  }
  try {
    const parsed = JSON.parse(raw) as { groups?: unknown; calendars?: unknown } | null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_TREE_FOLD;
    }
    return {
      groups: {
        ...DEFAULT_TREE_FOLD.groups,
        ...(booleanEntries(parsed.groups) as Partial<Record<GroupKey, boolean>>),
      },
      calendars: booleanEntries(parsed.calendars),
    };
  } catch {
    return DEFAULT_TREE_FOLD;
  }
}
