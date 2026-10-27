import type { EventInput } from "@fullcalendar/react";
import {
  PARENT_SHADE_INDEX,
  SHADE_COUNT,
  isHueFamily,
  shadeTokens,
  type ShadeTokens,
} from "@/lib/color/palette";
import { isActiveStatus } from "@/lib/domain/tasks";
import type { TaskView } from "@/lib/services/tasks";
import { addDaysToDate } from "@/lib/time/zone";

/**
 * Due tasks render as read-only all-day chips on the month grid, on their due
 * date (the time of day is not shown on the grid). They are ordinary
 * FullCalendar events — the grid gives them the same stacking and the built-in
 * "+N more" as event occurrences — but their ids are prefixed and
 * `extendedProps.kind` is `"task"`, so a click routes to the task panel instead
 * of the event details popover and the event drag/resize paths never see them.
 */
export const TASK_FC_ID_PREFIX = "task:";

export interface TaskChip extends EventInput {
  extendedProps: {
    kind: "task";
    taskId: string;
    collectionId: string;
    /** The owning list's name, for the chip's aria-label and debugging. */
    collectionName: string;
    /** False while the task is active: `CalendarShell.visibleTasks` keeps only `isActiveStatus` rows. */
    completed: boolean;
    /** Saturated collection accent: FullCalendar paints it as the left bar. */
    accent: string;
    /** The spoken summary; the visible title stays the bare task title. */
    ariaLabel: string;
  };
}

/**
 * The list's shade: a task uses its collection's own colour, and a legacy row
 * with no hue family falls back to the neutral root shade instead of throwing.
 */
function collectionTokens(task: TaskView): ShadeTokens {
  const { hueFamily, shadeIndex } = task.collection;
  if (
    hueFamily !== null &&
    isHueFamily(hueFamily) &&
    Number.isInteger(shadeIndex) &&
    shadeIndex >= 0 &&
    shadeIndex < SHADE_COUNT
  ) {
    return shadeTokens(hueFamily, shadeIndex);
  }
  return shadeTokens("slate", PARENT_SHADE_INDEX);
}

/**
 * One task → one FullCalendar event, or `null` when it has no due date. `end` is
 * the exclusive next day (FullCalendar's all-day contract), so a one-day task
 * fills exactly its own day and no `toISOString()` is involved.
 */
export function taskChip(task: TaskView): TaskChip | null {
  if (task.dueOn === null) {
    return null;
  }
  const tokens = collectionTokens(task);
  return {
    id: `${TASK_FC_ID_PREFIX}${task.id}`,
    title: task.title,
    allDay: true,
    start: task.dueOn,
    end: addDaysToDate(task.dueOn, 1),
    // Read-only calendar citizens: the chip opens the task, it never drags,
    // resizes or opens the event editor.
    editable: false,
    durationEditable: false,
    classNames: ["fc-task-chip"],
    extendedProps: {
      kind: "task",
      taskId: task.id,
      collectionId: task.collectionId,
      collectionName: task.collection.name,
      completed: !isActiveStatus(task.status),
      accent: tokens.mainHex,
      ariaLabel: `Task: ${task.title}`,
    },
  };
}
