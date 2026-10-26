import { describe, expect, it } from "vitest";
import { updateTaskInData, type TasksCacheData } from "@/lib/query/taskCache";
import type { TaskCounts, TaskView } from "@/lib/services/tasks";

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

const COUNTS: TaskCounts = { inbox: 1, today: 0, week: 0, someday: 1, overdue: 0 };

function makeData(tasks: TaskView[]): TasksCacheData {
  return { tasks, counts: COUNTS };
}

describe("updateTaskInData", () => {
  it("patches only the task with the matching id", () => {
    const data = makeData([makeTask({ id: "t1" }), makeTask({ id: "t2", title: "Water plants" })]);
    const after = updateTaskInData(data, "t1", { title: "Buy oat milk", status: "done" });

    expect(after.tasks[0]?.title).toBe("Buy oat milk");
    expect(after.tasks[0]?.status).toBe("done");
    // The untouched row keeps its identity, so React can skip re-rendering it.
    expect(after.tasks[1]).toBe(data.tasks[1]);
  });

  it("is a no-op for an unknown id", () => {
    const data = makeData([makeTask({ id: "t1" }), makeTask({ id: "t2" })]);
    const after = updateTaskInData(data, "missing", { title: "Nope" });

    expect(after.tasks.map((task) => task.title)).toEqual(["Buy milk", "Buy milk"]);
    expect(after.counts).toBe(COUNTS);
  });

  it("returns a new object and a new array without mutating the input", () => {
    const data = makeData([makeTask({ id: "t1", title: "Buy milk" })]);
    const after = updateTaskInData(data, "t1", { title: "Buy oat milk" });

    expect(after).not.toBe(data);
    expect(after.tasks).not.toBe(data.tasks);
    expect(data.tasks[0]?.title).toBe("Buy milk");
  });

  it("leaves counts untouched", () => {
    const data = makeData([makeTask({ id: "t1" })]);
    const after = updateTaskInData(data, "t1", { completedAt: 1_000 });

    expect(after.counts).toBe(COUNTS);
    expect(after.counts).toEqual({ inbox: 1, today: 0, week: 0, someday: 1, overdue: 0 });
  });
});
