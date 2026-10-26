import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { patchTask } from "@/lib/query/tasks";
import { patchTasksEntry, updateTaskInData, type TasksCacheData } from "@/lib/query/taskCache";
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

describe("optimistic priority patch", () => {
  it("patches priority across every cached tasks payload and restores both on rollback", () => {
    const queryClient = new QueryClient();
    const openKey = ["tasks", "all", null, "open"];
    const closedKey = ["tasks", "today", null, "closed"];
    queryClient.setQueryData(openKey, makeData([makeTask({ id: "t1", priority: "none" })]));
    queryClient.setQueryData(closedKey, makeData([makeTask({ id: "t1", priority: "low" })]));

    // Mirrors useUpdateTask's onMutate: snapshot every ["tasks", …] payload, then
    // apply one patch to the same row in each of them.
    const snapshots = queryClient.getQueriesData<TasksCacheData>({ queryKey: ["tasks"] });
    expect(snapshots).toHaveLength(2);
    queryClient.setQueriesData<unknown>({ queryKey: ["tasks"] }, (old: unknown) =>
      patchTasksEntry(old, "t1", patchTask({ priority: "urgent" })),
    );

    expect(queryClient.getQueryData<TasksCacheData>(openKey)?.tasks[0]?.priority).toBe("urgent");
    expect(queryClient.getQueryData<TasksCacheData>(closedKey)?.tasks[0]?.priority).toBe("urgent");

    // Mirrors onError's restoreTasks: replaying the snapshot puts both values back.
    for (const [key, data] of snapshots) {
      queryClient.setQueryData(key, data);
    }
    expect(queryClient.getQueryData<TasksCacheData>(openKey)?.tasks[0]?.priority).toBe("none");
    expect(queryClient.getQueryData<TasksCacheData>(closedKey)?.tasks[0]?.priority).toBe("low");

    queryClient.clear();
  });
});

describe("patchTasksEntry", () => {
  it("leaves the counts entry (which shares the tasks prefix) untouched", () => {
    const countsEntry = { counts: COUNTS, byCollection: { c1: 1 } };
    expect(patchTasksEntry(countsEntry, "t1", { title: "Nope" })).toBe(countsEntry);
    expect(patchTasksEntry(undefined, "t1", { title: "Nope" })).toBeUndefined();
    expect(patchTasksEntry(null, "t1", { title: "Nope" })).toBeNull();
  });

  it("patches a real tasks payload and leaves other rows alone", () => {
    const data = makeData([makeTask({ id: "t1" }), makeTask({ id: "t2" })]);
    const patched = patchTasksEntry(data, "t1", { title: "Renamed" }) as TasksCacheData;
    expect(patched.tasks[0]?.title).toBe("Renamed");
    expect(patched.tasks[1]).toBe(data.tasks[1]);
    expect(patched.counts).toBe(data.counts);
  });
});
