"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { TaskPriority, TaskStatus } from "@/lib/db/schema";
import { endOfWeek, localToday, type TaskBucket } from "@/lib/domain/tasks";
import { filterTasks, groupTasks, sortTasks } from "@/lib/domain/taskViews";
import { useCollections } from "@/lib/query/collections";
import { useCreateTask, useDeleteTask, useTasks, useUpdateTask } from "@/lib/query/tasks";
import { canWriteCollection, foldCollectionPermission } from "@/lib/services/permissions";
import type { TaskView } from "@/lib/services/tasks";
import { taskDeepLinkAction } from "@/lib/ui/taskDeepLink";
import {
  mergeTaskViewParams,
  parseTaskViewState,
  type TaskViewState,
} from "@/lib/ui/taskViewParams";
import { pushUndo } from "@/lib/ui/undo";
import { undoToast } from "@/lib/ui/undoToast";
import { resolveSomedayTriage, useTaskShortcuts } from "@/lib/ui/useTaskShortcuts";
import { useUndoHotkey } from "@/lib/ui/useUndoHotkey";
import type { UpdateTaskInput } from "@/lib/validation/tasks";
import { TaskCaptureRow } from "./TaskCaptureRow";
import { TaskList } from "./TaskList";
import { TaskPanel } from "./TaskPanel";
import { TaskShortcutHelpDialog } from "./TaskShortcutHelpDialog";
import { TaskToolbar } from "./TaskToolbar";
import { TASK_BUCKET_LABELS, TaskViewTabs } from "./TaskViewTabs";
import type { TaskActions, WritableList } from "./types";

interface Props {
  timezone: string;
  weekStartsOn: 0 | 1;
  /** Every page-scoped task key is inert when the user turned shortcuts off. */
  shortcutsEnabled: boolean;
  currentUserId: string;
}

/** The no-other-list toast: the `4` gesture is a no-op with a single list. */
const NO_OTHER_LIST = "No other writable list to move to.";
/** Key `3` on an already-undated Inbox task has three honest outcomes. */
const FILED_TO_SOMEDAY = "Filed to Someday";
const ALREADY_SOMEDAY = "Already in Someday";
const ALREADY_UNSCHEDULED = "Already unscheduled";

/** Stack label + success toast for each status transition (undo is the reverse). */
const STATUS_COPY: Record<TaskStatus, { label: string; message: string }> = {
  done: { label: "Complete task", message: "Task completed" },
  in_progress: { label: "Start task", message: "Task started" },
  open: { label: "Reopen task", message: "Task reopened" },
  dropped: { label: "Drop task", message: "Task dropped" },
};

/** One deep-link lookup: the task, or the message the settle site should toast. */
type DeepLinkResult = { ok: true; task: TaskView } | { ok: false; error: string };

/**
 * The deep link's single `GET /api/tasks/{id}`. It resolves instead of toasting
 * so the settle site (which knows whether the request is still wanted) owns the
 * error toast; a request cancelled by a param change or unmount stays silent.
 */
async function fetchDeepLinkTask(taskId: string): Promise<DeepLinkResult> {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    const payload = (await response.json().catch(() => null)) as {
      task?: TaskView;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.task) {
      throw new Error(payload?.error?.message ?? "Could not open the task.");
    }
    return { ok: true, task: payload.task };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not open the task.",
    };
  }
}

/** Field-wise equality, so the URL-sync effect does not re-render on an identical parse. */
function sameTaskViewState(a: TaskViewState, b: TaskViewState): boolean {
  return (
    a.layout === b.layout &&
    a.group === b.group &&
    a.sort === b.sort &&
    a.closed === b.closed &&
    a.collectionId === b.collectionId &&
    a.status.length === b.status.length &&
    a.status.every((value, index) => value === b.status[index]) &&
    a.priority.length === b.priority.length &&
    a.priority.every((value, index) => value === b.priority[index])
  );
}

/**
 * The `/tasks` workspace: the capture row, scope tabs, view toolbar, the grouped
 * list, the right slide-over task panel, plus the page-scoped keyboard
 * triage/undo layers.
 *
 * `TaskViewState` (layout/group/sort/closed/filters) is the single URL-backed
 * state: it is parsed once from `useSearchParams`, written with `router.replace`
 * through `mergeTaskViewParams` on every toolbar change, and re-parsed when the
 * URL changes underneath (Back/Forward). The scope (Inbox/Today/Week/Someday)
 * stays local like v0.2.0 and switching it clears the selection while keeping
 * the URL state. Rows are a pure projection: `sortTasks(filterTasks(...))` then
 * `groupTasks(...)`.
 *
 * Selection is an id over the visible rows. `j`/`k` move it (clamped, starting
 * at the first/last row when nothing is selected) and focus the row; clicking
 * or tabbing to a row also selects it. When a mutation removes the selected row
 * from the view, the selection and focus move to the nearest survivor so the
 * next triage key still has a target. The keys are page-scoped: the calendar's
 * own `j`/`k` mean period navigation on `/`.
 *
 * Undo is targeted: every complete/reopen/drop/delete/schedule/move/priority
 * change pushes a compensating action and shows `undoToast` with that action's
 * handle, so the toast reverts exactly what it describes. `z`/`Ctrl+Z` mount
 * here too and consume the shared stack LIFO, exactly as on the calendar. Title
 * edits are the one silent mutation (the field is inline and retyping reverts
 * it); notes and checklist edits keep the v0.2.0 editor's silent save.
 */
export function TasksShell({ timezone, weekStartsOn, shortcutsEnabled, currentUserId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Same one-shot contract for an absent and an empty `?task=`.
  const taskParam = searchParams.get("task") || null;
  const [state, setState] = useState<TaskViewState>(() =>
    parseTaskViewState(new URLSearchParams(searchParams.toString())),
  );
  const [view, setView] = useState<TaskBucket>("inbox");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editorTask, setEditorTask] = useState<TaskView | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scopeRef = useRef<HTMLButtonElement | null>(null);
  // The last rendered rows, so a vanished selection can be located even though
  // the fetch that removed it has already painted.
  const previousTasksRef = useRef<TaskView[]>([]);
  // The deep link is a one-shot: it must not reopen the panel after the user
  // closes it and the task list re-renders underneath. The marker is only set
  // once a lookup settles — see `lib/ui/taskDeepLink.ts` for the StrictMode
  // ordering rule that makes an early marker lose the panel entirely.
  const deepLinkHandledRef = useRef<string | null>(null);
  // One in-flight GET per deep-linked id. React's development double-invoke
  // (setup → cleanup → setup) cancels the first closure before the response;
  // caching the promise by param lets the second setup await the same request
  // instead of starting another one (or skipping it because it looked handled).
  const deepLinkRequestRef = useRef<{
    param: string;
    promise: Promise<DeepLinkResult>;
  } | null>(null);
  const tasksRef = useRef<TaskView[]>([]);
  const today = useMemo(() => localToday(timezone), [timezone]);
  const tasksQuery = useTasks(view, state.collectionId ?? undefined, state.closed);
  const collectionsQuery = useCollections();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();

  // Same gesture as the calendar: `z`/`Ctrl+Z` undo the newest action. The task
  // keys never use `z`, so the two layers cannot clash.
  useUndoHotkey();

  // Stable identity so the selection-coherence effect depends on the rows, not
  // on a fresh `[]` from every render.
  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  // Counts stay undefined until the first payload: the tabs show no badges
  // while loading or after an error instead of lying with a row of zeros.
  const counts = tasksQuery.data?.counts;

  // The URL is the source of truth for the toolbar state: a Back/Forward (or a
  // pasted link) re-parses it here. This is React's "adjust state when a prop
  // changes" pattern (a render-time sync keyed by the query string), not an
  // effect: `updateState` has already set the local state optimistically, and
  // when the replaced URL catches up the parsed values compare equal, so no
  // extra render is scheduled.
  const searchKey = searchParams.toString();
  const [syncedSearchKey, setSyncedSearchKey] = useState(searchKey);
  if (searchKey !== syncedSearchKey) {
    const fromUrl = parseTaskViewState(new URLSearchParams(searchKey));
    setSyncedSearchKey(searchKey);
    if (!sameTaskViewState(state, fromUrl)) {
      setState(fromUrl);
    }
  }

  // The visible rows: filter → sort → group. Traversal (`j`/`k`), the selection
  // coherence effect and the list all read this projection, so a filtered-out
  // row can never keep an invisible selection alive.
  const rows = useMemo(
    () =>
      sortTasks(
        filterTasks(tasks, {
          status: state.status,
          priority: state.priority,
          collectionId: state.collectionId,
        }),
        state.sort,
      ),
    [state.collectionId, state.priority, state.sort, state.status, tasks],
  );
  const groups = useMemo(() => groupTasks(rows, state.group), [rows, state.group]);
  const visibleRows = useMemo(() => groups.flatMap((group) => group.tasks), [groups]);
  const selectedTask = visibleRows.find((task) => task.id === selectedTaskId) ?? null;
  const filtersActive =
    state.status.length > 0 || state.priority.length > 0 || state.collectionId !== null;

  // What the panel renders: the live row while it is still in the payload, and
  // `editorTask` once a mutation removes it. `editorTask` is not the open-time
  // snapshot for long — `patch` refreshes it from every successful PATCH echo —
  // so completing or dropping from the panel cannot rewind it to its old status
  // when the open-only payload drops the row on the settle refetch.
  const livePanelTask =
    editorTask === null ? null : (tasks.find((task) => task.id === editorTask.id) ?? null);
  const panelTask = livePanelTask ?? editorTask;

  // The deep-link effect runs once per param and must not re-run when rows
  // arrive, so it reads the latest rows through a ref instead of a dependency.
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // A calendar task chip navigates to `/tasks?task=<id>`: open that task's
  // panel. The current view's rows are preferred (they are the live snapshot
  // the panel expects); otherwise one GET covers a task that is not in the
  // open bucket yet — and a scheduled task is never in the Inbox view, so that
  // GET is the normal path, not a fallback. A missing/unreadable task toasts
  // and drops the param.
  //
  // Nothing is marked handled until the lookup settles: StrictMode's dev
  // setup → cleanup → setup runs this effect twice, and an early marker would
  // make the second setup return while the first closure is already cancelled.
  useEffect(() => {
    if (taskParam === null) {
      deepLinkHandledRef.current = null;
      deepLinkRequestRef.current = null;
      return;
    }
    const known = tasksRef.current.find((task) => task.id === taskParam);
    const action = taskDeepLinkAction({
      param: taskParam,
      handled: deepLinkHandledRef.current,
      hasCachedRow: known !== undefined,
      pendingParam: deepLinkRequestRef.current?.param ?? null,
    });
    if (action === "reset" || action === "skip") {
      return;
    }
    if (action === "open-cached") {
      deepLinkHandledRef.current = taskParam;
      if (known) {
        setEditorTask(known);
      }
      return;
    }
    if (action === "fetch") {
      deepLinkRequestRef.current = { param: taskParam, promise: fetchDeepLinkTask(taskParam) };
    }

    const request = deepLinkRequestRef.current;
    if (!request) {
      return;
    }
    // The cleanup only cancels *this* closure (param changed or unmounted). The
    // request itself stays cached so the next setup of the same param can await
    // it, and the handled marker is set at the settle site, after it lands.
    let cancelled = false;
    void request.promise.then((result) => {
      if (cancelled || deepLinkRequestRef.current !== request) {
        return;
      }
      deepLinkHandledRef.current = request.param;
      deepLinkRequestRef.current = null;
      if (result.ok) {
        setEditorTask(result.task);
        return;
      }
      toast.error(result.error);
      // Drop only `?task=`, preserving the toolbar state that is also in the URL.
      const params = new URLSearchParams(window.location.search);
      params.delete("task");
      const query = params.toString();
      router.replace(query.length > 0 ? `/tasks?${query}` : "/tasks");
    });
    return () => {
      cancelled = true;
    };
  }, [router, taskParam]);

  // Selection coherence: complete/drop/delete/plan/move/priority/filter changes
  // can all remove the selected row from the visible rows once the settle
  // refetch (or the local filter) paints. The stale id would then name no row,
  // so the next triage key would silently no-op; move the selection (and focus,
  // because focus follows selection) to the row that took its place, or hand
  // focus to the current scope tab when nothing is visible. While the panel is
  // open the selection still moves (it is non-modal, so the list keeps painting
  // underneath), and `closeEditor` focuses the live selection on close. Runs
  // only after a painted list change, never during load or a scope switch.
  useEffect(() => {
    const previous = previousTasksRef.current;
    previousTasksRef.current = visibleRows;
    if (selectedTaskId === null || tasksQuery.isPending) {
      return;
    }
    if (visibleRows.some((task) => task.id === selectedTaskId)) {
      return;
    }
    const staleIndex = previous.findIndex((task) => task.id === selectedTaskId);
    const next =
      staleIndex === -1
        ? visibleRows[0]
        : visibleRows[Math.min(staleIndex, visibleRows.length - 1)];
    // The selection must follow the fetched list, not the other way round: this
    // is a reconciliation with data that arrived after the mutation, so it
    // cannot move into the mutation callback or a render-time derivation.
    setSelectedTaskId(next ? next.id : null);
    if (editorTask !== null) {
      return;
    }
    if (next) {
      // Focus follows selection: the next triage key acts on this row. The
      // effect runs after commit, so the row is already in the DOM.
      focusRow(next.id);
    } else {
      // No rows left: the scope tab is a real keyboard stop, so `j` still means
      // "next row" from here (focusing the capture input would type the letter).
      scopeRef.current?.focus();
    }
  }, [editorTask, tasksQuery.isPending, selectedTaskId, visibleRows]);

  // Move targets are the viewer's writable lists, labelled by their parent when
  // nested. The server stays authoritative: a stale tree still gets a 403.
  const moveTargets = useMemo<WritableList[]>(() => {
    const viewer = { userId: currentUserId, householdId: "" };
    const targets: WritableList[] = [];
    for (const root of collectionsQuery.data ?? []) {
      if (root.kind !== "list") {
        continue;
      }
      if (canWriteCollection(viewer, foldCollectionPermission(root))) {
        targets.push({ id: root.id, name: root.name });
      }
      for (const child of root.children) {
        if (child.kind !== "list") {
          continue;
        }
        if (canWriteCollection(viewer, foldCollectionPermission(child, root))) {
          targets.push({ id: child.id, name: `${root.name} / ${child.name}` });
        }
      }
    }
    return targets;
  }, [collectionsQuery.data, currentUserId]);

  /**
   * Write the next toolbar state to both React and the URL. `replace`, never
   * `push`: toolbar changes are view state, so Back should leave `/tasks`
   * instead of undoing each click. `mergeTaskViewParams` preserves `view`/`task`
   * and drops default-valued keys.
   */
  function updateState(next: TaskViewState): void {
    setState(next);
    const params = mergeTaskViewParams(new URLSearchParams(searchParams.toString()), next);
    const query = params.toString();
    router.replace(query.length > 0 ? `/tasks?${query}` : "/tasks");
  }

  /** Remove the one-shot `?task=` while keeping every other URL param. */
  function clearTaskParam(): void {
    if (taskParam === null) {
      return;
    }
    const params = mergeTaskViewParams(new URLSearchParams(searchParams.toString()), state);
    params.delete("task");
    const query = params.toString();
    router.replace(query.length > 0 ? `/tasks?${query}` : "/tasks");
  }

  /** One PATCH with the shared failure toast; the caller owns success/undo. */
  function patch(
    target: TaskView,
    input: UpdateTaskInput,
    options: { failure: string; onSuccess?: (saved: TaskView) => void },
  ): void {
    updateTask.mutate(
      { id: target.id, ...input },
      {
        onSuccess: ({ task: saved }) => {
          // Keep the open panel's snapshot current: a complete/drop/reschedule
          // can remove the row from an open-only payload on the settle refetch,
          // and the panel must keep painting the saved row, not its open-time
          // copy. Only the task the panel is showing is refreshed.
          setEditorTask((current) => (current !== null && current.id === saved.id ? saved : current));
          options.onSuccess?.(saved);
        },
        onError: () => toast.error(options.failure),
      },
    );
  }

  /**
   * The panel's title edit: the one deliberately silent mutation. There is no
   * success toast and no undo handle because the field is inline and retyping
   * the old title is the revert; a rejected PATCH still toasts.
   */
  function patchTitle(target: TaskView, title: string): void {
    if (title === target.title) {
      return;
    }
    patch(target, { title }, { failure: "Could not rename the task." });
  }

  /**
   * The panel's checklist. Task 5's contract is a whole-array replacement, so
   * every add/toggle/remove sends the complete list (the service regenerates
   * the item ids). Like the v0.2.0 editor's checklist save it is silent.
   */
  function patchChecklist(target: TaskView, items: { title: string; done: boolean }[]): void {
    patch(target, { checklist: items }, { failure: "Could not save the checklist." });
  }

  /** Status transition + the compensating PATCH, skipped when the server echoes. */
  function patchStatus(target: TaskView, status: TaskStatus): void {
    patch(target, { status }, {
      failure: "Could not update the task.",
      onSuccess: (saved) => {
        // The service leaves a no-transition PATCH untouched; an Undo for it
        // would be a lie, so only a real change pushes an action.
        if (saved.status === target.status) {
          return;
        }
        const copy = STATUS_COPY[status];
        const handle = pushUndo({
          label: copy.label,
          undo: async () => {
            await updateTask.mutateAsync({ id: target.id, status: target.status });
          },
        });
        undoToast(copy.message, handle);
      },
    });
  }

  /** Priority change + the PATCH that restores the previous level. */
  function patchPriority(target: TaskView, priority: TaskPriority): void {
    patch(target, { priority }, {
      failure: "Could not update the priority.",
      onSuccess: (saved) => {
        if (saved.priority === target.priority) {
          return;
        }
        const handle = pushUndo({
          label: "Change priority",
          undo: async () => {
            await updateTask.mutateAsync({ id: target.id, priority: target.priority });
          },
        });
        undoToast("Priority updated", handle);
      },
    });
  }

  /** Date change + the PATCH that puts both dates back where they were. */
  function patchSchedule(
    target: TaskView,
    input: Pick<UpdateTaskInput, "scheduledOn" | "dueOn">,
    message: string,
  ): void {
    patch(target, input, {
      failure: "Could not schedule the task.",
      onSuccess: (saved) => {
        if (saved.scheduledOn === target.scheduledOn && saved.dueOn === target.dueOn) {
          return;
        }
        const handle = pushUndo({
          label: "Schedule task",
          undo: async () => {
            await updateTask.mutateAsync({
              id: target.id,
              scheduledOn: target.scheduledOn,
              dueOn: target.dueOn,
            });
          },
        });
        undoToast(message, handle);
      },
    });
  }

  /** Move + the PATCHes that return the row to its old list and position. */
  function patchMove(target: TaskView, collectionId: string, message = "Task moved"): void {
    if (collectionId === target.collectionId) {
      return;
    }
    patch(target, { collectionId }, {
      failure: "Could not move the task.",
      onSuccess: () => {
        const handle = pushUndo({
          label: "Move task",
          undo: async () => {
            // A move always appends, so the original position needs a second
            // PATCH after the row is back in its source list.
            await updateTask.mutateAsync({ id: target.id, collectionId: target.collectionId });
            await updateTask.mutateAsync({ id: target.id, sortOrder: target.sortOrder });
          },
        });
        undoToast(message, handle);
      },
    });
  }

  /**
   * Delete + undo. There is no trash table, so the undo re-creates the task:
   * `POST /api/tasks` restores the row's own fields, then one PATCH restores the
   * checklist and the original list position (POST accepts neither). The
   * re-created task gets a **new id** — the old id is gone.
   */
  function deleteTaskWithUndo(target: TaskView): void {
    deleteTask.mutate(target.id, {
      onSuccess: () => {
        const handle = pushUndo({
          label: "Delete task",
          undo: async () => {
            const created = await createTask.mutateAsync({
              title: target.title,
              notes: target.notes,
              collectionId: target.collectionId,
              scheduledOn: target.scheduledOn,
              dueOn: target.dueOn,
            });
            await updateTask.mutateAsync({
              id: created.task.id,
              checklist: target.checklist.map((item) => ({ title: item.title, done: item.done })),
              sortOrder: target.sortOrder,
            });
          },
        });
        undoToast("Task deleted", handle);
      },
      onError: () => toast.error("Could not delete the task."),
    });
  }

  /** A scope switch keeps the URL-backed toolbar state but drops the selection. */
  function changeScope(next: TaskBucket): void {
    // A selection is only meaningful against the rows of the view it was made
    // in; keeping the id would leave an invisible selection behind the switch.
    setView(next);
    setSelectedTaskId(null);
  }

  /** Focus the row that already carries the target id (rows render before state commits). */
  function focusRow(id: string): void {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-task-id]") ?? []);
    rows.find((row) => row.dataset.taskId === id)?.focus();
  }

  /** Open the slide-over for one task, selecting its row first. */
  function openTask(target: TaskView): void {
    // Select first so the row is already the return target when the panel
    // closes (or a panel edit re-buckets the task out of this view).
    setSelectedTaskId(target.id);
    setEditorTask(target);
  }

  /**
   * Close the panel (Esc, the header button, Delete or a deep-link close) and
   * hand focus back to the live selection. The name predates the panel and is
   * kept because the mechanism — clear the snapshot, drop `?task=`, focus the
   * selected row on the next paint — is unchanged from the modal editor.
   */
  function closeEditor(): void {
    setEditorTask(null);
    // A deep-linked panel leaves the URL clean on close; otherwise a reload
    // (or a back navigation) would reopen a panel the user already dismissed.
    clearTaskParam();
    // The panel is non-modal and takes no focus hostage, but its opener can be a
    // row that a panel edit just removed from the view. Focus the live selection
    // on the next paint instead (the rows have re-rendered by then).
    window.setTimeout(() => {
      const selected = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
      if (selected) {
        selected.focus();
        return;
      }
      scopeRef.current?.focus();
    }, 0);
  }

  function moveSelection(delta: 1 | -1): void {
    if (visibleRows.length === 0) {
      return;
    }
    const currentIndex = visibleRows.findIndex((task) => task.id === selectedTaskId);
    // With no selection, `j` starts at the top and `k` at the bottom.
    const base = currentIndex === -1 ? (delta === 1 ? -1 : visibleRows.length) : currentIndex;
    const nextIndex = Math.max(0, Math.min(visibleRows.length - 1, base + delta));
    const next = visibleRows[nextIndex];
    if (!next) {
      return;
    }
    setSelectedTaskId(next.id);
    focusRow(next.id);
  }

  function triageSelection(bucket: 1 | 2 | 3): void {
    if (!selectedTask) {
      return;
    }
    if (bucket === 1) {
      patchSchedule(selectedTask, { scheduledOn: today }, "Task scheduled");
      return;
    }
    if (bucket === 2) {
      // D6: on the last day of the household week this equals today, so the task
      // lands in Today rather than silently into next week.
      patchSchedule(
        selectedTask,
        { scheduledOn: endOfWeek(today, weekStartsOn) },
        "Task scheduled",
      );
      return;
    }
    // `3` ("Someday"): clearing dates is a no-op on an Inbox task that is
    // already undated, so that case files it into the next writable list
    // instead — which is what actually moves it out of the Inbox.
    const target = nextListTarget(selectedTask);
    const action = resolveSomedayTriage({
      scheduledOn: selectedTask.scheduledOn,
      dueOn: selectedTask.dueOn,
      view,
      hasOtherWritableList: target !== null,
    });
    if (action.kind === "clear-dates") {
      patchSchedule(selectedTask, { scheduledOn: null, dueOn: null }, "Task unscheduled");
      return;
    }
    if (action.kind === "file-to-list") {
      if (target) {
        patchMove(selectedTask, target.id, FILED_TO_SOMEDAY);
      }
      return;
    }
    if (action.kind === "already-someday") {
      toast(ALREADY_SOMEDAY);
      return;
    }
    toast(ALREADY_UNSCHEDULED);
  }

  /** The next writable list after the task's own, wrapping; `null` when there is none. */
  function nextListTarget(task: TaskView): WritableList | null {
    const currentIndex = moveTargets.findIndex((target) => target.id === task.collectionId);
    const start = currentIndex === -1 ? 0 : currentIndex + 1;
    for (let step = 0; step < moveTargets.length; step += 1) {
      const candidate = moveTargets[(start + step) % moveTargets.length];
      if (candidate && candidate.id !== task.collectionId) {
        return candidate;
      }
    }
    return null;
  }

  function moveToNextList(): void {
    if (!selectedTask) {
      return;
    }
    const target = nextListTarget(selectedTask);
    if (!target) {
      toast(NO_OTHER_LIST);
      return;
    }
    patchMove(selectedTask, target.id);
  }

  function completeSelection(): void {
    if (selectedTask) {
      patchStatus(selectedTask, "done");
    }
  }

  function openSelection(): void {
    if (selectedTask) {
      openTask(selectedTask);
    }
  }

  /** Toast copy for a chip change; the chips send exactly one date field. */
  function dateMessage(patch: { scheduledOn?: string | null; dueOn?: string | null }): string {
    if (patch.dueOn !== undefined) {
      return patch.dueOn === null ? "Due date cleared" : "Due date updated";
    }
    return patch.scheduledOn === null ? "Task unscheduled" : "Task scheduled";
  }

  /** The row/card/panel callbacks, bound to one task. */
  function actionsFor(task: TaskView): TaskActions {
    return {
      onOpen: () => openTask(task),
      onTitle: (title) => patchTitle(task, title),
      onStatus: (status) => patchStatus(task, status),
      onPriority: (priority) => patchPriority(task, priority),
      onDates: (patch) => patchSchedule(task, patch, dateMessage(patch)),
      onMove: (collectionId) => patchMove(task, collectionId),
      onDrop: () => patchStatus(task, "dropped"),
      onDelete: () => deleteTaskWithUndo(task),
      onToggleDone: (done) => patchStatus(task, done ? "done" : "open"),
    };
  }

  /** The toolbar's Add task focuses the capture row's input (same DOM id contract). */
  function focusCapture(): void {
    document.getElementById("task-capture")?.focus();
  }

  function clearFilters(): void {
    updateState({ ...state, status: [], priority: [], collectionId: null });
  }

  useTaskShortcuts(shortcutsEnabled, {
    onMoveSelection: moveSelection,
    onBucket: triageSelection,
    onNextList: moveToNextList,
    onComplete: completeSelection,
    onOpen: openSelection,
    onHelp: () => setHelpOpen(true),
    onEscape: () => setSelectedTaskId(null),
  });

  return (
    // `weekStartsOn` and `shortcutsEnabled` are consumed directly by the layer
    // above; the data attributes stay as debugging/E2E hooks.
    <section
      aria-label="Tasks"
      data-testid="tasks-shell"
      data-week-starts-on={weekStartsOn}
      data-shortcuts-enabled={shortcutsEnabled ? "true" : "false"}
      className="mt-6 space-y-3"
    >
      <TaskCaptureRow timezone={timezone} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <TaskViewTabs
          view={view}
          counts={counts}
          layout={state.layout}
          onScope={changeScope}
          onLayout={(layout) => updateState({ ...state, layout })}
          activeRef={scopeRef}
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelpOpen(true)}
          className="shrink-0 text-ink-soft [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        >
          <span aria-hidden>?</span>
        </Button>
      </div>

      <TaskToolbar
        state={state}
        onChange={updateState}
        onAddTask={focusCapture}
        lists={moveTargets}
      />

      {state.layout === "board" ? (
        <p
          role="status"
          className="rounded-md border border-line bg-well px-3 py-2 text-sm text-ink-soft"
        >
          Board view ships in the next change — showing the list for now.
        </p>
      ) : null}

      {tasksQuery.isError ? (
        <div role="alert" className="rounded-md border border-line-strong bg-surface p-6">
          <p className="text-ink">Could not load the tasks.</p>
          <Button
            className="mt-3"
            disabled={tasksQuery.isFetching}
            onClick={() => void tasksQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : tasksQuery.isPending ? (
        <p role="status" className="px-2 py-6 text-sm text-ink-soft">
          Loading tasks…
        </p>
      ) : (
        <div ref={listRef} role="group" aria-label={`${TASK_BUCKET_LABELS[view]} tasks`}>
          <TaskList
            groups={groups}
            today={today}
            selectedId={selectedTaskId}
            onFocus={setSelectedTaskId}
            actionsFor={actionsFor}
            moveTargets={moveTargets}
            emptyMessage={
              filtersActive ? "No tasks match these filters." : "Nothing here. Enjoy the quiet."
            }
            onClearFilters={filtersActive ? clearFilters : null}
          />
        </div>
      )}

      {panelTask === null ? null : (
        // The panel gets the row's own actions, except Delete, which closes the
        // panel first so the undo toast is not hidden behind it.
        <TaskPanel
          task={panelTask}
          today={today}
          onClose={closeEditor}
          moveTargets={moveTargets}
          actions={{
            ...actionsFor(panelTask),
            onDelete: () => {
              closeEditor();
              deleteTaskWithUndo(panelTask);
            },
          }}
          onChecklist={(items) => patchChecklist(panelTask, items)}
        />
      )}
      <TaskShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </section>
  );
}
