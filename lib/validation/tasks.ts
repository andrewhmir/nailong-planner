import { z } from "zod";
import { TASK_BUCKETS } from "@/lib/domain/tasks";

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

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  notes: z.string().max(2000).nullish(),
  collectionId: z.string().min(1).optional(),
  scheduledOn: dateOnlySchema.nullish(),
  dueOn: dateOnlySchema.nullish(),
});

/**
 * `.partial()` of create plus the service-owned fields. `nullish()` dates keep
 * their "clear the date" meaning; `status` mirrors `TaskStatus`, and
 * `collectionId` moves the task (the service checks write access on both lists).
 */
export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(["open", "done", "dropped"]).optional(),
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
 * GET /api/tasks query. Both filters are optional: no `view` means every open
 * visible task, and an unknown `collectionId` deliberately returns an empty
 * list rather than a 404 (existence is never leaked by a filter).
 */
export const listTasksQuerySchema = z.object({
  view: taskViewSchema.optional(),
  collectionId: z.string().min(1).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
