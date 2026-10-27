import { describe, expect, it } from "vitest";
import {
  filterTasks,
  groupTasks,
  sortTasks,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_PRIORITY_RANK,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  type GroupableTask,
  type GroupBy,
  type TaskFilters,
  type TaskSort,
} from "@/lib/domain/taskViews";

/**
 * Task-view ordering rules (spec: List/Board grouping, filtering and the five
 * sort orders). The fixtures are local `make()` rows rather than `TaskView`
 * objects: the module's constraints are structural, so a row only has to carry
 * the fields the function reads. Every date is a household-local `YYYY-MM-DD`
 * and every time a household-local `HH:MM`; a task has one deadline (`dueOn`),
 * and within one day a timed deadline sorts before an untimed one.
 */

interface FixtureTask extends GroupableTask {
  collectionId: string;
}

const WORK = { id: "list-work", name: "Work" };
const HOME = { id: "list-home", name: "Home" };

function make(overrides: Partial<FixtureTask> = {}): FixtureTask {
  return {
    id: "task-1",
    title: "A task",
    status: "open",
    priority: "none",
    dueOn: null,
    dueTime: null,
    sortOrder: 0,
    createdAt: 1,
    collectionId: WORK.id,
    collection: WORK,
    ...overrides,
  };
}

const SORTS: TaskSort[] = ["manual", "priority", "due", "created", "title"];
const GROUPINGS: GroupBy[] = ["status", "priority", "list"];

function ids(tasks: readonly FixtureTask[]): string[] {
  return tasks.map((task) => task.id);
}

describe("label and order tables", () => {
  it("labels statuses and priorities the way the UI shows them", () => {
    expect(TASK_STATUS_LABELS).toEqual({
      open: "To do",
      in_progress: "In progress",
      done: "Done",
      dropped: "Dropped",
    });
    expect(TASK_PRIORITY_LABELS).toEqual({
      urgent: "Urgent",
      high: "High",
      normal: "Normal",
      low: "Low",
      none: "None",
    });
    expect(TASK_STATUS_LABELS.in_progress).toBe("In progress");
  });

  it("orders statuses by workflow and priorities most urgent first", () => {
    expect(TASK_STATUS_ORDER).toEqual(["open", "in_progress", "done", "dropped"]);
    expect(TASK_PRIORITY_ORDER).toEqual(["urgent", "high", "normal", "low", "none"]);
    expect(TASK_PRIORITY_ORDER.map((priority) => TASK_PRIORITY_RANK[priority])).toEqual([
      4, 3, 2, 1, 0,
    ]);
  });
});

describe("sortTasks", () => {
  it("sorts by priority then due date, with undated rows last", () => {
    const rows = [
      make({ id: "normal", priority: "normal", dueOn: "2026-10-24" }),
      make({ id: "none-undated", priority: "none" }),
      make({ id: "urgent-undated", priority: "urgent" }),
      make({ id: "high-late", priority: "high", dueOn: "2026-10-30" }),
      make({ id: "high-early", priority: "high", dueOn: "2026-10-20" }),
      make({ id: "urgent-dated", priority: "urgent", dueOn: "2026-10-22" }),
      make({ id: "high-undated-old", priority: "high", createdAt: 2 }),
      make({ id: "high-undated-new", priority: "high", createdAt: 9 }),
      make({ id: "low-undated", priority: "low" }),
    ];

    expect(ids(sortTasks(rows, "priority"))).toEqual([
      "urgent-dated",
      "urgent-undated",
      "high-early",
      "high-late",
      "high-undated-old",
      "high-undated-new",
      "normal",
      "low-undated",
      "none-undated",
    ]);
  });

  it("sorts manual order by sortOrder, then createdAt, then id", () => {
    const rows = [
      make({ id: "second", sortOrder: 1, createdAt: 20 }),
      make({ id: "third-by-id", sortOrder: 1, createdAt: 10 }),
      make({ id: "first", sortOrder: 0, createdAt: 99 }),
      make({ id: "second-by-id", sortOrder: 1, createdAt: 10 }),
    ];

    expect(ids(sortTasks(rows, "manual"))).toEqual([
      "first",
      "second-by-id",
      "third-by-id",
      "second",
    ]);
  });

  it("sorts by due date, then due time, undated last, then priority", () => {
    const rows = [
      make({ id: "later", dueOn: "2026-11-02" }),
      // Urgent but undated: the missing date still puts it behind every dated row.
      make({ id: "undated", priority: "urgent" }),
      make({ id: "earliest", dueOn: "2026-10-21" }),
      make({ id: "same-day-timed", dueOn: "2026-10-23", dueTime: "09:00", priority: "low" }),
      // Untimed is "any time that day", so it sorts after a timed deadline even
      // when it outranks it on priority.
      make({ id: "same-day-untimed", dueOn: "2026-10-23", priority: "urgent" }),
    ];

    expect(ids(sortTasks(rows, "due"))).toEqual([
      "earliest",
      "same-day-timed",
      "same-day-untimed",
      "later",
      "undated",
    ]);
  });

  it("sorts created newest first", () => {
    const rows = [
      make({ id: "old", createdAt: 100 }),
      make({ id: "newest", createdAt: 300 }),
      make({ id: "middle", createdAt: 200 }),
    ];

    expect(ids(sortTasks(rows, "created"))).toEqual(["newest", "middle", "old"]);
  });

  it("sorts title alphabetically with localeCompare", () => {
    const rows = [
      make({ id: "cherry", title: "cherry" }),
      make({ id: "apple", title: "apple" }),
      make({ id: "banana", title: "banana" }),
    ];

    expect(ids(sortTasks(rows, "title"))).toEqual(["apple", "banana", "cherry"]);
  });

  it("returns a sorted copy and leaves the input untouched", () => {
    const rows = [make({ id: "b", sortOrder: 1 }), make({ id: "a", sortOrder: 0 })];

    const sorted = sortTasks(rows, "manual");

    expect(sorted).not.toBe(rows);
    expect(ids(sorted)).toEqual(["a", "b"]);
    expect(ids(rows)).toEqual(["b", "a"]);
  });
});

describe("groupTasks", () => {
  it("groups by status in fixed order and omits empty groups", () => {
    const rows = [
      make({ id: "open-1", status: "open" }),
      make({ id: "progress-1", status: "in_progress" }),
      make({ id: "open-2", status: "open" }),
      make({ id: "done-1", status: "done" }),
    ];

    const groups = groupTasks(rows, "status");

    expect(groups.map((group) => group.key)).toEqual(["open", "in_progress", "done"]);
    expect(groups.map((group) => group.label)).toEqual(["To do", "In progress", "Done"]);
    expect(groups.map((group) => ids(group.tasks))).toEqual([
      ["open-1", "open-2"],
      ["progress-1"],
      ["done-1"],
    ]);
  });

  it("groups by priority urgent to none, omitting empty priorities", () => {
    const rows = [
      make({ id: "normal-1", priority: "normal" }),
      make({ id: "urgent-1", priority: "urgent" }),
      make({ id: "urgent-2", priority: "urgent" }),
      make({ id: "low-1", priority: "low" }),
    ];

    const groups = groupTasks(rows, "priority");

    expect(groups.map((group) => group.key)).toEqual(["urgent", "normal", "low"]);
    expect(groups.map((group) => group.label)).toEqual(["Urgent", "Normal", "Low"]);
    expect(groups.map((group) => ids(group.tasks))).toEqual([
      ["urgent-1", "urgent-2"],
      ["normal-1"],
      ["low-1"],
    ]);
  });

  it("groups by list name alphabetically with the collection id as key", () => {
    const rows = [
      make({ id: "work-1", collectionId: WORK.id, collection: WORK }),
      make({ id: "home-1", collectionId: HOME.id, collection: HOME }),
      make({ id: "work-2", collectionId: WORK.id, collection: WORK }),
    ];

    const groups = groupTasks(rows, "list");

    expect(groups.map((group) => group.key)).toEqual([HOME.id, WORK.id]);
    expect(groups.map((group) => group.label)).toEqual(["Home", "Work"]);
    expect(groups.map((group) => ids(group.tasks))).toEqual([["home-1"], ["work-1", "work-2"]]);
  });
});

describe("filterTasks", () => {
  const rows = [
    make({ id: "match", status: "open", priority: "high", collectionId: WORK.id, collection: WORK }),
    make({ id: "done", status: "done", priority: "high", collectionId: WORK.id, collection: WORK }),
    make({
      id: "normal",
      status: "open",
      priority: "normal",
      collectionId: WORK.id,
      collection: WORK,
    }),
    make({ id: "home", status: "open", priority: "high", collectionId: HOME.id, collection: HOME }),
  ];

  it("intersects the status set, the priority set and the collection id", () => {
    const filters: TaskFilters = { status: ["open"], priority: ["high"], collectionId: WORK.id };

    expect(ids(filterTasks(rows, filters))).toEqual(["match"]);
  });

  it("treats an empty list or a null collection as no constraint", () => {
    expect(ids(filterTasks(rows, { status: [], priority: [], collectionId: null }))).toEqual([
      "match",
      "done",
      "normal",
      "home",
    ]);
    expect(ids(filterTasks(rows, { status: [], priority: ["high"], collectionId: null }))).toEqual([
      "match",
      "done",
      "home",
    ]);
    expect(
      ids(filterTasks(rows, { status: ["in_progress", "done"], priority: [], collectionId: null })),
    ).toEqual(["done"]);
  });
});

describe("empty input", () => {
  it("returns empty arrays for every view operation", () => {
    for (const sort of SORTS) {
      expect(sortTasks([], sort)).toEqual([]);
    }
    for (const by of GROUPINGS) {
      expect(groupTasks([], by)).toEqual([]);
    }
    expect(filterTasks([], { status: [], priority: [], collectionId: null })).toEqual([]);
  });
});
