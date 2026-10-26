import type { TaskPriority, TaskStatus } from "@/lib/db/schema";
import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  type GroupBy,
  type TaskLayout,
  type TaskSort,
} from "@/lib/domain/taskViews";

/**
 * Pure URL codec for the `/tasks` toolbar state (spec §6).
 *
 * The page owns `?view=` (scope) and `?task=` (panel deep link); this module owns
 * the rest: `layout`, `group`, `sort`, `closed=1`, comma-joined `status` and
 * `priority`, and `list=<collectionId>`. Defaults are omitted from the URL so a
 * bare `/tasks` stays clean, and unknown enum values fall back to those defaults
 * rather than throwing: a stale bookmark or a hand-edited URL must not break the
 * page.
 *
 * All functions are pure over `URLSearchParams` — no React, no router, no DOM.
 * The caller mirrors the merged result with `router.replace()` (never `push()`):
 * toolbar changes are view state, so they must not add a history entry per click
 * (the browser Back button should leave `/tasks`, not undo each filter).
 */

/** The toolbar/filter state encoded in `/tasks` query params. */
export interface TaskViewState {
  layout: TaskLayout;
  group: GroupBy;
  sort: TaskSort;
  /** `closed=1`: include `done`/`dropped` rows (the "show closed" toggle). */
  closed: boolean;
  /** Empty means "no status filter". */
  status: TaskStatus[];
  /** Empty means "no priority filter". */
  priority: TaskPriority[];
  /** `list=<id>`; `null` means every visible list. */
  collectionId: string | null;
}

/** `list`/`status`/`manual`, closed hidden, no filters. */
export const DEFAULT_TASK_VIEW_STATE: TaskViewState = {
  layout: "list",
  group: "status",
  sort: "manual",
  closed: false,
  status: [],
  priority: [],
  collectionId: null,
};

const TASK_LAYOUTS: readonly TaskLayout[] = ["list", "board"];
const GROUP_BYS: readonly GroupBy[] = ["status", "priority", "list"];
const TASK_SORTS: readonly TaskSort[] = ["manual", "priority", "due", "created", "title"];

/** The keys this module writes; `view`/`task` are page-owned and left alone. */
const MANAGED_PARAMS = [
  "layout",
  "group",
  "sort",
  "closed",
  "status",
  "priority",
  "list",
] as const;

/** A single-valued enum param: unknown (or absent) values fall back to the default. */
function parseEnum<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * A comma-separated enum list. Values are trimmed, filtered to the known set,
 * and de-duplicated while keeping their first-seen order, so `open,done,open`
 * reads as `["open", "done"]` and `bogus` disappears.
 */
function parseEnumList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (raw === null) {
    return [];
  }
  const seen = new Set<string>();
  const values: T[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === "" || seen.has(value) || !(allowed as readonly string[]).includes(value)) {
      continue;
    }
    seen.add(value);
    values.push(value as T);
  }
  return values;
}

/**
 * Reads a `/tasks` URL into the toolbar state. `layout`, `group` and `sort` fall
 * back to their defaults (as do the individual filter values); `closed` is on
 * only for the literal `1`; an empty `list` is no list filter.
 */
export function parseTaskViewState(params: URLSearchParams): TaskViewState {
  const collectionId = params.get("list");
  return {
    layout: parseEnum(params.get("layout"), TASK_LAYOUTS, DEFAULT_TASK_VIEW_STATE.layout),
    group: parseEnum(params.get("group"), GROUP_BYS, DEFAULT_TASK_VIEW_STATE.group),
    sort: parseEnum(params.get("sort"), TASK_SORTS, DEFAULT_TASK_VIEW_STATE.sort),
    closed: params.get("closed") === "1",
    status: parseEnumList(params.get("status"), TASK_STATUS_ORDER),
    priority: parseEnumList(params.get("priority"), TASK_PRIORITY_ORDER),
    collectionId: collectionId === null || collectionId === "" ? null : collectionId,
  };
}

/**
 * Returns a **new** `URLSearchParams` carrying `base`'s page-owned params
 * (`view`, `task`, and anything else) plus `state`. Every managed key is deleted
 * first, so a stale `layout=board` cannot survive a return to the default, and
 * only non-default values are written back. The argument is never mutated.
 */
export function mergeTaskViewParams(
  base: URLSearchParams,
  state: TaskViewState,
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of MANAGED_PARAMS) {
    params.delete(key);
  }
  if (state.layout !== DEFAULT_TASK_VIEW_STATE.layout) {
    params.set("layout", state.layout);
  }
  if (state.group !== DEFAULT_TASK_VIEW_STATE.group) {
    params.set("group", state.group);
  }
  if (state.sort !== DEFAULT_TASK_VIEW_STATE.sort) {
    params.set("sort", state.sort);
  }
  if (state.closed) {
    params.set("closed", "1");
  }
  if (state.status.length > 0) {
    params.set("status", state.status.join(","));
  }
  if (state.priority.length > 0) {
    params.set("priority", state.priority.join(","));
  }
  if (state.collectionId !== null && state.collectionId !== "") {
    params.set("list", state.collectionId);
  }
  return params;
}
