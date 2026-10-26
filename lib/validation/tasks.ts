import { z } from "zod";
import type { TaskStatus } from "@/lib/db/schema";
import { TASK_ACTIVE_STATUSES, TASK_BUCKETS } from "@/lib/domain/tasks";

/**
 * `scheduledOn` and `dueOn` are date-only household-local `YYYY-MM-DD` strings,
 * never epochs, so validation only has to enforce the shape. Mirrors the
 * `dateString` regex in `lib/validation/events.ts`.
 */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

/** A task's flat checklist, in display order. At most 50 items. */
export const checklistInputSchema = z
  .array(
    z.object({
      title: z.string().trim().min(1, "Give the item a title.").max(200),
      done: z.boolean(),
    }),
  )
  .max(50);

/** ClickUp-style importance. Mirrors `TaskPriority` in the schema. */
export const prioritySchema = z.enum(["none", "low", "normal", "high", "urgent"]);

/**
 * `status` on create exists for the board's per-column quick add. Only the two
 * **active** statuses are accepted: `done`/`dropped` are closed states with
 * audit semantics (they own `completedAt`/`droppedAt`), so a task is never born
 * closed — complete or drop it through a PATCH instead.
 */
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  notes: z.string().max(2000).nullish(),
  collectionId: z.string().min(1).optional(),
  scheduledOn: dateOnlySchema.nullish(),
  dueOn: dateOnlySchema.nullish(),
  priority: prioritySchema.optional(),
  // Derived from the domain's active pair, so a future active status cannot be
  // forgotten here (a hand-copied enum would drift silently).
  status: z
    .enum(TASK_ACTIVE_STATUSES as unknown as [TaskStatus, ...TaskStatus[]])
    .optional(),
});

/**
 * `.partial()` of create plus the service-owned fields. `nullish()` dates keep
 * their "clear the date" meaning; `status` mirrors `TaskStatus`, and
 * `collectionId` moves the task (the service checks write access on both lists).
 */
export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(["open", "in_progress", "done", "dropped"]).optional(),
  checklist: checklistInputSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** The full open-task order of one list; the service rejects partial/duplicate sets. */
export const reorderTasksSchema = z.object({
  collectionId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
});

/**
 * The wire name of the triage filter: a bucket or `"all"`. Built from
 * `TASK_BUCKETS` so a new bucket reaches the API without a second edit.
 */
export const taskViewSchema = z.enum([...TASK_BUCKETS, "all"]);

/**
 * GET /api/tasks query. Every filter is optional: no `view` means every active
 * visible task, and an unknown `collectionId` deliberately returns an empty
 * list rather than a 404 (existence is never leaked by a filter).
 * `includeClosed` arrives as the literal query-string `"true"`/`"false"` and is
 * mapped to a boolean here. It must stay an `enum` transform: `z.coerce.boolean()`
 * would make `Boolean("false")` true.
 */
export const listTasksQuerySchema = z.object({
  view: taskViewSchema.optional(),
  collectionId: z.string().min(1).optional(),
  includeClosed: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
