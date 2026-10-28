"use client";

import { Fragment } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon, PlusIcon } from "@/components/ui/icons";
import type { TaskPriority, TaskStatus } from "@/lib/db/schema";
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  type GroupBy,
  type TaskSort,
} from "@/lib/domain/taskViews";
import type { TaskViewState } from "@/lib/ui/taskViewParams";
import type { WritableList } from "./types";
import { cn } from "@/lib/utils";

/** Dense toolbar control: plain buttons keep the text-xs height and violet ring. */
const TRIGGER =
  "inline-flex h-7 items-center gap-1 rounded-sm border border-line-strong bg-surface px-2 text-xs text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11";

const GROUP_LABELS: Readonly<Record<GroupBy, string>> = {
  status: "Status",
  priority: "Priority",
  list: "List",
};

const GROUP_ORDER: readonly GroupBy[] = ["status", "priority", "list"];

const SORT_LABELS: Readonly<Record<TaskSort, string>> = {
  manual: "Manual",
  priority: "Priority",
  due: "Due date",
  created: "Created",
  title: "Title",
};

const SORT_ORDER: readonly TaskSort[] = ["manual", "priority", "due", "created", "title"];

interface Props {
  state: TaskViewState;
  onChange(next: TaskViewState): void;
  /** Focuses the capture row's input; the shell owns that DOM id. */
  onAddTask(): void;
  /**
   * The writable collections the filter offers, already ordered root-then-
   * children. The shell passes every writable collection (calendars and lists);
   * `kind` and `rootId` let this menu rebuild the sidebar tree.
   */
  lists: WritableList[];
}

/**
 * The view toolbar: Add task, Group, Filter, Sort and the Hide closed toggle.
 * It owns no state — every menu change calls `onChange({ ...state, key })`, and
 * the shell writes the result into the URL. In board layout the Group menu is
 * disabled because a board is always grouped by status; Sort, Filter and Hide
 * closed stay available.
 */
export function TaskToolbar({ state, onChange, onAddTask, lists }: Props) {
  const boardLayout = state.layout === "board";
  const activeFilters =
    state.status.length + state.priority.length + (state.collectionId === null ? 0 : 1);
  // The filter menu mirrors the sidebar tree: roots in list order, each followed
  // by its children (indented). A root selection filters the whole subtree,
  // because the shell resolves the id to `{self} ∪ children` before matching.
  const calendarRoots = lists.filter((item) => item.kind === "calendar" && item.rootId === null);
  const listRoots = lists.filter((item) => item.kind === "list" && item.rootId === null);
  const childrenOf = (rootId: string): WritableList[] =>
    lists.filter((item) => item.rootId === rootId);

  function toggleStatus(status: TaskStatus): void {
    const statuses = state.status.includes(status)
      ? state.status.filter((value) => value !== status)
      : [...state.status, status];
    // Done/Dropped rows are only fetched when closed rows are shown; ticking one
    // of those filters without the flag would silently produce an empty list.
    const needsClosed = statuses.includes("done") || statuses.includes("dropped");
    onChange({ ...state, status: statuses, closed: needsClosed ? true : state.closed });
  }

  function togglePriority(priority: TaskPriority): void {
    const priorities = state.priority.includes(priority)
      ? state.priority.filter((value) => value !== priority)
      : [...state.priority, priority];
    onChange({ ...state, priority: priorities });
  }

  function toggleCollection(collectionId: string): void {
    onChange({ ...state, collectionId: state.collectionId === collectionId ? null : collectionId });
  }

  function clearFilters(): void {
    onChange({ ...state, status: [], priority: [], collectionId: null });
  }

  return (
    <div role="group" aria-label="Task view controls" className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={boardLayout}
            title={boardLayout ? "The board is always grouped by status." : undefined}
            aria-label={`Group: ${GROUP_LABELS[state.group]}`}
            className={TRIGGER}
          >
            <span>Group: {GROUP_LABELS[state.group]}</span>
            <ChevronDownIcon size={12} className="shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup
            value={state.group}
            onValueChange={(value) => onChange({ ...state, group: value as GroupBy })}
          >
            {GROUP_ORDER.map((group) => (
              <DropdownMenuRadioItem key={group} value={group}>
                {GROUP_LABELS[group]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={activeFilters === 0 ? "Filter" : `Filter, ${activeFilters} active`}
            className={cn(TRIGGER, activeFilters > 0 && "border-violet text-violet-press")}
          >
            <span>Filter</span>
            {activeFilters === 0 ? null : (
              <span
                aria-hidden
                data-testid="task-filter-count"
                className="rounded-pill bg-violet-press px-1.5 text-xs font-bold text-white"
              >
                {activeFilters}
              </span>
            )}
            <ChevronDownIcon size={12} className="shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[min(70vh,420px)] overflow-y-auto">
          {TASK_STATUS_ORDER.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={state.status.includes(status)}
              onCheckedChange={() => toggleStatus(status)}
            >
              {TASK_STATUS_LABELS[status]}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Priority</DropdownMenuLabel>
          {TASK_PRIORITY_ORDER.map((priority) => (
            <DropdownMenuCheckboxItem
              key={priority}
              checked={state.priority.includes(priority)}
              onCheckedChange={() => togglePriority(priority)}
            >
              {TASK_PRIORITY_LABELS[priority]}
            </DropdownMenuCheckboxItem>
          ))}
          {calendarRoots.length === 0 ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Calendar</DropdownMenuLabel>
              <p className="px-4 pb-1 text-xs text-ink-mute">
                A calendar includes its sub-calendars.
              </p>
              {calendarRoots.map((root) => (
                <Fragment key={root.id}>
                  <DropdownMenuCheckboxItem
                    checked={state.collectionId === root.id}
                    onCheckedChange={() => toggleCollection(root.id)}
                  >
                    {root.label}
                  </DropdownMenuCheckboxItem>
                  {childrenOf(root.id).map((child) => (
                    <DropdownMenuCheckboxItem
                      key={child.id}
                      checked={state.collectionId === child.id}
                      onCheckedChange={() => toggleCollection(child.id)}
                    >
                      <span className="pl-4">{child.label}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </Fragment>
              ))}
            </>
          )}
          {listRoots.length === 0 ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>List</DropdownMenuLabel>
              <p className="px-4 pb-1 text-xs text-ink-mute">A list includes its sub-lists.</p>
              {listRoots.map((root) => (
                <Fragment key={root.id}>
                  <DropdownMenuCheckboxItem
                    checked={state.collectionId === root.id}
                    onCheckedChange={() => toggleCollection(root.id)}
                  >
                    {root.label}
                  </DropdownMenuCheckboxItem>
                  {childrenOf(root.id).map((child) => (
                    <DropdownMenuCheckboxItem
                      key={child.id}
                      checked={state.collectionId === child.id}
                      onCheckedChange={() => toggleCollection(child.id)}
                    >
                      <span className="pl-4">{child.label}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </Fragment>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={activeFilters === 0} onSelect={clearFilters}>
            Clear filters
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Sort: ${SORT_LABELS[state.sort]}`} className={TRIGGER}>
            <span>Sort: {SORT_LABELS[state.sort]}</span>
            <ChevronDownIcon size={12} className="shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup
            value={state.sort}
            onValueChange={(value) => onChange({ ...state, sort: value as TaskSort })}
          >
            {SORT_ORDER.map((sort) => (
              <DropdownMenuRadioItem key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        aria-pressed={!state.closed}
        data-testid="task-toggle-closed"
        title={state.closed ? "Stop showing done and dropped tasks" : "Show done and dropped tasks"}
        onClick={() => onChange({ ...state, closed: !state.closed })}
        className={cn(TRIGGER, "aria-pressed:border-violet aria-pressed:text-violet-press")}
      >
        Hide closed
      </button>

      <button
        type="button"
        data-testid="task-add"
        onClick={onAddTask}
        className="ml-auto inline-flex h-7 items-center gap-1 rounded-sm bg-violet-press px-2.5 text-xs font-bold text-white transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11"
      >
        <PlusIcon size={14} />
        <span>Add task</span>
      </button>
    </div>
  );
}
