"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { TaskStatus } from "@/lib/db/schema";
import { endOfWeek, localToday, type TaskBucket } from "@/lib/domain/tasks";
import { useCollections } from "@/lib/query/collections";
import { useCreateTask, useDeleteTask, useTasks, useUpdateTask } from "@/lib/query/tasks";
import { canWriteCollection, foldCollectionPermission } from "@/lib/services/permissions";
import type { TaskView } from "@/lib/services/tasks";
import { taskDeepLinkAction } from "@/lib/ui/taskDeepLink";
import { pushUndo } from "@/lib/ui/undo";
import { undoToast } from "@/lib/ui/undoToast";
import { useTaskShortcuts, resolveSomedayTriage } from "@/lib/ui/useTaskShortcuts";
import { useUndoHotkey } from "@/lib/ui/useUndoHotkey";
import type { UpdateTaskInput } from "@/lib/validation/tasks";
import { TaskCaptureBar } from "./TaskCaptureBar";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { TaskRow } from "./TaskRow";
import { TaskShortcutHelpDialog } from "./TaskShortcutHelpDialog";
import { TASK_BUCKET_LABELS, TaskViewSwitcher } from "./TaskViewSwitcher";

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

/**
 * The `/tasks` workspace: capture bar, the Inbox · Today · Week · Someday
 * switcher, the active view's rows, the editor and the page's keyboard triage
 * layer. All bucket membership and counts come from the server
 * (`GET /api/tasks?view=`); this shell only chooses the view and turns row
 * actions, the editor and keys into PATCHes/POSTs/DELETEs, toasting on failure.
 *
 * Selection is an id over the current view's rows. `j`/`k` move it (clamped,
 * starting at the first/last row when nothing is selected) and focus the row;
 * clicking or tabbing to a row also selects it. When a mutation removes the
 * selected row from the view, the selection and focus move to the nearest
 * survivor so the next triage key still has a target. The keys are page-scoped:
 * the calendar's own `j`/`k` mean period navigation on `/`.
 *
 * Undo is targeted: every complete/reopen/drop/delete/schedule/move pushes a
 * compensating action and shows `undoToast` with that action's handle, so the
 * toast reverts exactly what it describes. `z`/`Ctrl+Z` mount here too and
 * consume the shared stack LIFO, exactly as on the calendar.
 */
export function TasksShell({ timezone, weekStartsOn, shortcutsEnabled, currentUserId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Same one-shot contract for an absent and an empty `?task=`.
  const taskParam = searchParams.get("task") || null;
  const [view, setView] = useState<TaskBucket>("inbox");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editorTask, setEditorTask] = useState<TaskView | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const switcherRef = useRef<HTMLButtonElement | null>(null);
  // The last rendered rows, so a vanished selection can be located even though
  // the fetch that removed it has already painted.
  const previousTasksRef = useRef<TaskView[]>([]);
  // The deep link is a one-shot: it must not reopen the editor after the user
  // closes it and the task list re-renders underneath. The marker is only set
  // once a lookup settles — see `lib/ui/taskDeepLink.ts` for the StrictMode
  // ordering rule that makes an early marker lose the editor entirely.
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
  const tasksQuery = useTasks(view);
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
  // Counts stay undefined until the first payload: the switcher shows no badges
  // while loading or after an error instead of lying with a row of zeros.
  const counts = tasksQuery.data?.counts;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  // The deep-link effect runs once per param and must not re-run when rows
  // arrive, so it reads the latest rows through a ref instead of a dependency.
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // A calendar task chip navigates to `/tasks?task=<id>`: open that task's
  // editor. The current view's rows are preferred (they are the live snapshot
  // the editor expects); otherwise one GET covers a task that is not in the
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
      router.replace("/tasks");
    });
    return () => {
      cancelled = true;
    };
  }, [router, taskParam]);

  // Selection coherence: complete/drop/delete/plan/move all end with the row
  // leaving the open view after the settle refetch. The stale id would then name
  // no row, so the next triage key would silently no-op; move the selection (and
  // focus, because focus follows selection) to the row that took its place, or
  // hand focus to the view switcher when the view is now empty. While the editor
  // is open the selection still moves (the dialog is modal and owns focus), and
  // `closeEditor` focuses the live selection on close. Runs only after a painted
  // list change, never during load or a view switch.
  useEffect(() => {
    const previous = previousTasksRef.current;
    previousTasksRef.current = tasks;
    if (selectedTaskId === null || tasksQuery.isPending) {
      return;
    }
    if (tasks.some((task) => task.id === selectedTaskId)) {
      return;
    }
    const staleIndex = previous.findIndex((task) => task.id === selectedTaskId);
    const next = staleIndex === -1 ? tasks[0] : tasks[Math.min(staleIndex, tasks.length - 1)];
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
      // No rows left: the switcher is a real keyboard stop, so `j` still means
      // "next row" from here (focusing the capture input would type the letter).
      switcherRef.current?.focus();
    }
  }, [editorTask, tasks, tasksQuery.isPending, selectedTaskId]);

  // Move targets are the viewer's writable lists, labelled by their parent when
  // nested. The server stays authoritative: a stale tree still gets a 403.
  const moveTargets = useMemo(() => {
    const viewer = { userId: currentUserId, householdId: "" };
    const targets: Array<{ id: string; name: string }> = [];
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

  /** One PATCH with the shared failure toast; the caller owns success/undo. */
  function patch(
    target: TaskView,
    input: UpdateTaskInput,
    options: { failure: string; onSuccess?: (saved: TaskView) => void },
  ): void {
    updateTask.mutate(
      { id: target.id, ...input },
      {
        onSuccess: ({ task: saved }) => options.onSuccess?.(saved),
        onError: () => toast.error(options.failure),
      },
    );
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

  function changeView(next: TaskBucket): void {
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

  function openTask(target: TaskView): void {
    // Select first so the row is already the return target when the editor
    // closes (or its save re-buckets the task out of this view).
    setSelectedTaskId(target.id);
    setEditorTask(target);
  }

  function closeEditor(): void {
    setEditorTask(null);
    // A deep-linked editor leaves the URL clean on close; otherwise a reload
    // (or a back navigation) would reopen a dialog the user already dismissed.
    if (taskParam !== null) {
      router.replace("/tasks");
    }
    // Radix restores focus to the opener on close, but that opener can be a row
    // that a save just removed from the view. Focus the live selection on the
    // next paint instead (the rows have re-rendered by then).
    window.setTimeout(() => {
      const selected = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
      if (selected) {
        selected.focus();
        return;
      }
      switcherRef.current?.focus();
    }, 0);
  }

  function moveSelection(delta: 1 | -1): void {
    if (tasks.length === 0) {
      return;
    }
    const currentIndex = tasks.findIndex((task) => task.id === selectedTaskId);
    // With no selection, `j` starts at the top and `k` at the bottom.
    const base = currentIndex === -1 ? (delta === 1 ? -1 : tasks.length) : currentIndex;
    const nextIndex = Math.max(0, Math.min(tasks.length - 1, base + delta));
    const next = tasks[nextIndex];
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
  function nextListTarget(task: TaskView): { id: string; name: string } | null {
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
      className="mt-6 space-y-5"
    >
      <TaskCaptureBar timezone={timezone} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <TaskViewSwitcher
          view={view}
          counts={counts}
          onChange={changeView}
          activeRef={switcherRef}
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
      ) : tasks.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-surface px-4 py-10 text-center text-base text-ink-soft">
          Nothing here. Enjoy the quiet.
        </p>
      ) : (
        <ul
          ref={listRef}
          aria-label={`${TASK_BUCKET_LABELS[view]} tasks`}
          data-testid="task-list"
          className="rounded-md border border-line-strong bg-surface px-2"
        >
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              selected={task.id === selectedTaskId}
              onFocus={() => setSelectedTaskId(task.id)}
              moveTargets={moveTargets.filter((target) => target.id !== task.collectionId)}
              onToggleDone={(done) => patchStatus(task, done ? "done" : "open")}
              onPlan={(date) =>
                patchSchedule(
                  task,
                  { scheduledOn: date },
                  date === null ? "Task unscheduled" : "Task scheduled",
                )
              }
              onMove={(collectionId) => patchMove(task, collectionId)}
              onDrop={() => patchStatus(task, "dropped")}
              onDelete={() => deleteTaskWithUndo(task)}
              onEdit={() => openTask(task)}
            />
          ))}
        </ul>
      )}

      <TaskEditorDialog
        task={editorTask}
        today={today}
        onClose={closeEditor}
        onDelete={(target) => {
          closeEditor();
          deleteTaskWithUndo(target);
        }}
      />
      <TaskShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </section>
  );
}
