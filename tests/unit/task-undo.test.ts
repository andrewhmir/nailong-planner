import { describe, expect, it } from "vitest";
import type { TaskView } from "@/lib/services/tasks";
import { deletedTaskCreateInput, deletedTaskRestorePatch } from "@/lib/ui/taskUndo";

/**
 * A complete `TaskView`: the builders must be driven by a real row shape, not a
 * partial fixture, because the whole point is that no field of the deleted task
 * is silently dropped on the way back in.
 */
function makeTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: "t1",
    householdId: "h1",
    collectionId: "c1",
    title: "Buy milk",
    notes: null,
    status: "open",
    priority: "none",
    scheduledOn: null,
    dueOn: null,
    completedAt: null,
    droppedAt: null,
    sortOrder: 0,
    createdBy: "user-a",
    createdAt: 0,
    updatedAt: 0,
    checklist: [],
    collection: { id: "c1", name: "Inbox", kind: "list", hueFamily: "slate", shadeIndex: 0 },
    ...overrides,
  };
}

const CHECKLIST = [
  { id: "i1", title: "Oat milk", done: true },
  { id: "i2", title: "Bananas", done: false },
];

describe("deletedTaskCreateInput", () => {
  it("carries title, notes, dates, list and priority for an open task", () => {
    const task = makeTask({
      title: "Buy milk",
      notes: "Semi-skimmed",
      collectionId: "c9",
      scheduledOn: "2026-10-27",
      dueOn: "2026-10-28",
      priority: "normal",
    });

    const input = deletedTaskCreateInput(task);

    expect(input).toStrictEqual({
      title: "Buy milk",
      notes: "Semi-skimmed",
      collectionId: "c9",
      scheduledOn: "2026-10-27",
      dueOn: "2026-10-28",
      priority: "normal",
    });
    // `open` is the server default: sending it would be a status the create
    // schema accepts but the round trip never needs.
    expect(input).not.toHaveProperty("status");
  });

  it("always carries priority, including the default level", () => {
    const input = deletedTaskCreateInput(makeTask({ priority: "none" }));

    expect(input.priority).toBe("none");
    expect(Object.keys(input)).toContain("priority");
  });

  it("sends in_progress in the create body, because POST accepts the active pair", () => {
    const task = makeTask({ status: "in_progress", priority: "urgent" });

    const input = deletedTaskCreateInput(task);

    expect(input).toStrictEqual({
      title: task.title,
      notes: task.notes,
      collectionId: task.collectionId,
      scheduledOn: task.scheduledOn,
      dueOn: task.dueOn,
      priority: "urgent",
      status: "in_progress",
    });
  });

  it("never sends a closed status: done/dropped are restore-PATCH transitions", () => {
    for (const status of ["done", "dropped"] as const) {
      const input = deletedTaskCreateInput(makeTask({ status }));
      expect(input).not.toHaveProperty("status");
    }
  });
});

describe("deletedTaskRestorePatch", () => {
  it("is empty when the create body already carried everything", () => {
    const patch = deletedTaskRestorePatch(makeTask({ status: "open" }));

    expect(patch).toStrictEqual({});
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it("restores the checklist and the list position of a done task", () => {
    const task = makeTask({
      status: "done",
      completedAt: 1_700_000_000_000,
      sortOrder: 3,
      checklist: CHECKLIST,
    });

    const patch = deletedTaskRestorePatch(task);

    expect(patch).toStrictEqual({
      checklist: [
        { title: "Oat milk", done: true },
        { title: "Bananas", done: false },
      ],
      sortOrder: 3,
      status: "done",
    });
    // Item ids are service-owned; sending them back would be ignored anyway.
    expect(patch.checklist?.[0]).not.toHaveProperty("id");
  });

  it("restores a dropped status on its own", () => {
    const task = makeTask({ status: "dropped", droppedAt: 1_700_000_000_000, sortOrder: 0 });

    expect(deletedTaskRestorePatch(task)).toStrictEqual({ status: "dropped" });
  });

  it("does not re-send an in-progress status the create body already carried", () => {
    const patch = deletedTaskRestorePatch(makeTask({ status: "in_progress", sortOrder: 0 }));

    expect(patch).toStrictEqual({});
  });
});
