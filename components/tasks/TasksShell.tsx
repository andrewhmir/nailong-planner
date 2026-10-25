"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { endOfWeek, localToday, type TaskBucket } from "@/lib/domain/tasks";
import { useCollections } from "@/lib/query/collections";
import { useDeleteTask, useTasks, useUpdateTask } from "@/lib/query/tasks";
import { canWriteCollection, foldCollectionPermission } from "@/lib/services/permissions";
import type { TaskView } from "@/lib/services/tasks";
import { useTaskShortcuts } from "@/lib/ui/useTaskShortcuts";
import type { UpdateTaskInput } from "@/lib/validation/tasks";
import { TaskCaptureBar } from "./TaskCaptureBar";
import { TaskRow } from "./TaskRow";
import { TaskShortcutHelpDialog } from "./TaskShortcutHelpDialog";
import { TASK_BUCKET_LABELS, TaskViewSwitcher } from "./TaskViewSwitcher";

interface Props {
  timezone: string;
  weekStartsOn: 0 | 1;
  /** Every page-scoped task key is inert when the user turned shortcuts off. */
  shortcutsEnabled: boolean;
  currentUserId: string;
  /**
   * `Enter` hand-off for the task editor. Task 9 wires the gesture; Task 10
   * mounts `TaskEditorDialog` and passes this callback. Absent means the key is
   * accepted but has nowhere to open yet.
   */
  onOpenTask?: (task: TaskView) => void;
}

/** The no-other-list toast: the `4` gesture is a no-op with a single list. */
const NO_OTHER_LIST = "No other writable list to move to.";

/**
 * The `/tasks` workspace: capture bar, the Inbox · Today · Week · Someday
 * switcher, the active view's rows and the page's keyboard triage layer. All
 * bucket membership and counts come from the server (`GET /api/tasks?view=`);
 * this shell only chooses the view and turns row actions and keys into
 * PATCHes/DELETEs, toasting on failure.
 *
 * Selection is an id over the current view's rows. `j`/`k` move it (clamped,
 * starting at the first/last row when nothing is selected) and focus the row;
 * clicking or tabbing to a row also selects it. The keys are page-scoped: the
 * calendar's own `j`/`k` mean period navigation on `/`.
 */
export function TasksShell({
  timezone,
  weekStartsOn,
  shortcutsEnabled,
  currentUserId,
  onOpenTask,
}: Props) {
  const [view, setView] = useState<TaskBucket>("inbox");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const switcherRef = useRef<HTMLButtonElement | null>(null);
  // The last rendered rows, so a vanished selection can be located even though
  // the fetch that removed it has already painted.
  const previousTasksRef = useRef<TaskView[]>([]);
  const today = useMemo(() => localToday(timezone), [timezone]);
  const tasksQuery = useTasks(view);
  const collectionsQuery = useCollections();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  // Stable identity so the selection-coherence effect depends on the rows, not
  // on a fresh `[]` from every render.
  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  // Counts stay undefined until the first payload: the switcher shows no badges
  // while loading or after an error instead of lying with a row of zeros.
  const counts = tasksQuery.data?.counts;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  // Selection coherence: complete/drop/delete/plan/move all end with the row
  // leaving the open view after the settle refetch. The stale id would then name
  // no row, so the next triage key would silently no-op; move the selection (and
  // focus, because focus follows selection) to the row that took its place, or
  // hand focus to the view switcher when the view is now empty. Runs only after
  // a painted list change, never during load or a view switch.
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
    if (next) {
      // Focus follows selection: the next triage key acts on this row. The
      // effect runs after commit, so the row is already in the DOM.
      focusRow(next.id);
    } else {
      // No rows left: the switcher is a real keyboard stop, so `j` still means
      // "next row" from here (focusing the capture input would type the letter).
      switcherRef.current?.focus();
    }
  }, [tasks, tasksQuery.isPending, selectedTaskId]);

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

  function patch(task: TaskView, input: UpdateTaskInput, failure: string): void {
    updateTask.mutate({ id: task.id, ...input }, { onError: () => toast.error(failure) });
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
      patch(selectedTask, { scheduledOn: today }, "Could not schedule the task.");
      return;
    }
    if (bucket === 2) {
      // D6: on the last day of the household week this equals today, so the task
      // lands in Today rather than silently into next week.
      patch(
        selectedTask,
        { scheduledOn: endOfWeek(today, weekStartsOn) },
        "Could not schedule the task.",
      );
      return;
    }
    patch(selectedTask, { scheduledOn: null, dueOn: null }, "Could not schedule the task.");
  }

  function moveToNextList(): void {
    if (!selectedTask) {
      return;
    }
    if (moveTargets.length === 0) {
      toast(NO_OTHER_LIST);
      return;
    }
    const currentIndex = moveTargets.findIndex((target) => target.id === selectedTask.collectionId);
    const start = currentIndex === -1 ? 0 : currentIndex + 1;
    for (let step = 0; step < moveTargets.length; step += 1) {
      const candidate = moveTargets[(start + step) % moveTargets.length];
      if (candidate && candidate.id !== selectedTask.collectionId) {
        patch(selectedTask, { collectionId: candidate.id }, "Could not move the task.");
        return;
      }
    }
    toast(NO_OTHER_LIST);
  }

  function completeSelection(): void {
    if (selectedTask) {
      patch(selectedTask, { status: "done" }, "Could not update the task.");
    }
  }

  function openSelection(): void {
    if (selectedTask) {
      onOpenTask?.(selectedTask);
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
              onToggleDone={(done) =>
                patch(task, { status: done ? "done" : "open" }, "Could not update the task.")
              }
              onPlan={(date) =>
                patch(task, { scheduledOn: date }, "Could not schedule the task.")
              }
              onMove={(collectionId) =>
                patch(task, { collectionId }, "Could not move the task.")
              }
              onDrop={() => patch(task, { status: "dropped" }, "Could not drop the task.")}
              onDelete={() =>
                deleteTask.mutate(task.id, {
                  onError: () => toast.error("Could not delete the task."),
                })
              }
            />
          ))}
        </ul>
      )}

      <TaskShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </section>
  );
}
