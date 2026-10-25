"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { localToday, type TaskBucket } from "@/lib/domain/tasks";
import { useCollections } from "@/lib/query/collections";
import { useDeleteTask, useTasks, useUpdateTask } from "@/lib/query/tasks";
import { canWriteCollection } from "@/lib/services/permissions";
import type { TaskCounts, TaskView } from "@/lib/services/tasks";
import type { UpdateTaskInput } from "@/lib/validation/tasks";
import { TaskCaptureBar } from "./TaskCaptureBar";
import { TaskRow } from "./TaskRow";
import { TASK_BUCKET_LABELS, TaskViewSwitcher } from "./TaskViewSwitcher";

interface Props {
  timezone: string;
  weekStartsOn: 0 | 1;
  /** Read now for the keyboard triage layer that lands in Task 9. */
  shortcutsEnabled: boolean;
  currentUserId: string;
}

const EMPTY_COUNTS: TaskCounts = { inbox: 0, today: 0, week: 0, someday: 0, overdue: 0 };

/**
 * The `/tasks` workspace: capture bar, the Inbox · Today · Week · Someday
 * switcher and the active view's rows. All bucket membership and counts come
 * from the server (`GET /api/tasks?view=`); this shell only chooses the view and
 * turns row actions into PATCHes/DELETEs, toasting on failure.
 */
export function TasksShell({ timezone, weekStartsOn, shortcutsEnabled, currentUserId }: Props) {
  const [view, setView] = useState<TaskBucket>("inbox");
  const today = useMemo(() => localToday(timezone), [timezone]);
  const tasksQuery = useTasks(view);
  const collectionsQuery = useCollections();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const tasks = tasksQuery.data?.tasks ?? [];
  const counts = tasksQuery.data?.counts ?? EMPTY_COUNTS;

  // Move targets are the viewer's writable lists, labelled by their parent when
  // nested. The server stays authoritative: a stale tree still gets a 403.
  const moveTargets = useMemo(() => {
    const viewer = { userId: currentUserId, householdId: "" };
    const targets: Array<{ id: string; name: string }> = [];
    for (const root of collectionsQuery.data ?? []) {
      if (root.kind !== "list") {
        continue;
      }
      if (canWriteCollection(viewer, root)) {
        targets.push({ id: root.id, name: root.name });
      }
      for (const child of root.children) {
        if (child.kind !== "list") {
          continue;
        }
        const effective = {
          ownerId: root.ownerId ?? child.ownerId,
          visibility: root.visibility === "shared" ? child.visibility : root.visibility,
        };
        if (canWriteCollection(viewer, effective)) {
          targets.push({ id: child.id, name: `${root.name} / ${child.name}` });
        }
      }
    }
    return targets;
  }, [collectionsQuery.data, currentUserId]);

  function patch(task: TaskView, input: UpdateTaskInput, failure: string): void {
    updateTask.mutate({ id: task.id, ...input }, { onError: () => toast.error(failure) });
  }

  return (
    // `weekStartsOn` and `shortcutsEnabled` are the two page values Task 9's
    // keyboard layer reads; exposing them here keeps the shell's copy honest
    // until that layer consumes them directly.
    <section
      aria-label="Tasks"
      data-testid="tasks-shell"
      data-week-starts-on={weekStartsOn}
      data-shortcuts-enabled={shortcutsEnabled ? "true" : "false"}
      className="mt-6 space-y-5"
    >
      <TaskCaptureBar timezone={timezone} />

      <TaskViewSwitcher view={view} counts={counts} onChange={setView} />

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
          aria-label={`${TASK_BUCKET_LABELS[view]} tasks`}
          data-testid="task-list"
          className="rounded-md border border-line-strong bg-surface px-2"
        >
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
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
    </section>
  );
}
