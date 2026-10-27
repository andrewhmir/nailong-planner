import { describe, expect, it } from "vitest";
import type { TaskRow } from "@/lib/db/schema";
import {
  bucketOf,
  bucketOfIncludingClosed,
  endOfWeek,
  isActiveStatus,
  isOverdue,
  localToday,
  priorityRank,
  TASK_ACTIVE_STATUSES,
  TASK_BUCKETS,
  TASK_SCOPES,
  type BucketContext,
  type TaskBucket,
} from "@/lib/domain/tasks";

/**
 * Derived task buckets and scopes (spec D6 + ruling 29). Every expectation is
 * pinned to real calendar dates: 2026-10-21 is a Wednesday and 2026-10-25 is a
 * Sunday. A Sunday-started week ends on Saturday 2026-10-31; a Monday-started
 * week ends on Sunday 2026-10-25, because Sunday is its seventh and last day.
 * The bucket anchor is the earliest of `scheduledOn`/`dueOn`, so a past-due task
 * is never stranded by a later schedule. A bucket is a time horizon only: the
 * list that holds the task (the Inbox included) never changes it.
 */

const TODAY = "2026-10-21";
const END_OF_WEEK = "2026-10-25";
const INBOX_ID = "list-inbox";
const PROJECT_ID = "list-project";

const ctx: BucketContext = { today: TODAY, endOfWeek: END_OF_WEEK };

type BucketFields = Pick<TaskRow, "status" | "scheduledOn" | "dueOn">;

function task(overrides: Partial<BucketFields> = {}): BucketFields {
  return {
    status: overrides.status ?? "open",
    scheduledOn: overrides.scheduledOn ?? null,
    dueOn: overrides.dueOn ?? null,
  };
}

function bucketOfTask(overrides: Partial<BucketFields> = {}): TaskBucket | null {
  return bucketOf(task(overrides), ctx);
}

describe("TASK_BUCKETS and TASK_SCOPES", () => {
  it("lists the three time buckets and the four scope tabs in rail order", () => {
    expect(TASK_BUCKETS).toEqual(["today", "week", "someday"]);
    // All first and the default; `inbox` is retired as a scope.
    expect(TASK_SCOPES).toEqual(["all", "today", "week", "someday"]);
  });
});

describe("endOfWeek", () => {
  it("ends a Sunday-started week on Saturday", () => {
    // Sun 2026-10-25 opens its week; Wed 2026-10-21 is in the week before.
    expect(endOfWeek("2026-10-25", 0)).toBe("2026-10-31");
    expect(endOfWeek("2026-10-21", 0)).toBe("2026-10-24");
  });

  it("ends a Monday-started week on Sunday", () => {
    // The week containing Sun 2026-10-25 starts Mon 2026-10-19, so that Sunday
    // is already the last day; Mon 2026-10-26 opens the week ending 2026-11-01.
    // (The plan's example pins 2026-11-01 for Sun 2026-10-25, which would make
    // that week 14 days long and contradict D6's "last day of the week" case.)
    expect(endOfWeek("2026-10-25", 1)).toBe("2026-10-25");
    expect(endOfWeek("2026-10-19", 1)).toBe("2026-10-25");
    expect(endOfWeek("2026-10-21", 1)).toBe("2026-10-25");
    expect(endOfWeek("2026-10-26", 1)).toBe("2026-11-01");
  });
});

describe("bucketOf", () => {
  it("returns null for a task that is no longer open", () => {
    expect(bucketOfTask({ status: "done", scheduledOn: TODAY })).toBeNull();
    expect(bucketOfTask({ status: "dropped", scheduledOn: TODAY })).toBeNull();
    expect(bucketOfTask({ status: "done" })).toBeNull();
  });

  it("puts every undated active task in someday, whatever list holds it", () => {
    // The Inbox is a list, not a bucket: an undated capture is Someday.
    expect(bucketOfTask()).toBe("someday");
    const inboxRow = { ...task(), collectionId: INBOX_ID };
    const projectRow = { ...task(), collectionId: PROJECT_ID };
    expect(bucketOf(inboxRow, ctx)).toBe("someday");
    expect(bucketOf(projectRow, ctx)).toBe("someday");
  });

  it("buckets a dated task by its dates", () => {
    expect(bucketOfTask({ dueOn: TODAY })).toBe("today");
    expect(bucketOfTask({ scheduledOn: "2026-10-23" })).toBe("week");
  });

  it("puts scheduled work dated today or earlier in today", () => {
    expect(bucketOfTask({ scheduledOn: TODAY })).toBe("today");
    expect(bucketOfTask({ scheduledOn: "2026-10-20" })).toBe("today");
  });

  it("puts a due-only task in today or week, not someday", () => {
    // A deadline with no schedule is still work to do, so the absent
    // `scheduledOn` must not demote it to someday.
    expect(bucketOfTask({ dueOn: TODAY })).toBe("today");
    expect(bucketOfTask({ dueOn: "2026-10-19" })).toBe("today");
    expect(bucketOfTask({ dueOn: "2026-10-22" })).toBe("week");
  });

  it("puts work dated after today up to the end of the week in week", () => {
    expect(bucketOfTask({ scheduledOn: "2026-10-22" })).toBe("week");
    expect(bucketOfTask({ scheduledOn: END_OF_WEEK })).toBe("week");
    expect(bucketOfTask({ dueOn: END_OF_WEEK })).toBe("week");
  });

  it("anchors on the earliest of the schedule and the deadline", () => {
    // A later schedule must not hide work that is already overdue or due today,
    // and the deadline alone is a commitment when nothing scheduled the task.
    expect(bucketOfTask({ scheduledOn: "2026-10-26", dueOn: "2026-10-20" })).toBe("today");
    expect(bucketOfTask({ scheduledOn: "2026-10-26", dueOn: TODAY })).toBe("today");
    expect(bucketOfTask({ scheduledOn: "2026-10-26", dueOn: "2026-11-02" })).toBeNull();
    expect(bucketOfTask({ scheduledOn: "2026-10-23", dueOn: TODAY })).toBe("today");
  });

  it("leaves work dated beyond this week in no bucket", () => {
    expect(bucketOfTask({ scheduledOn: "2026-10-26" })).toBeNull();
    expect(bucketOfTask({ dueOn: "2026-11-02" })).toBeNull();
  });
});

describe("isOverdue", () => {
  it("is true only for an open task whose due date is strictly before today", () => {
    expect(isOverdue({ status: "open", dueOn: "2026-10-20" }, TODAY)).toBe(true);
    expect(isOverdue({ status: "open", dueOn: TODAY }, TODAY)).toBe(false);
    expect(isOverdue({ status: "open", dueOn: "2026-10-22" }, TODAY)).toBe(false);
    expect(isOverdue({ status: "open", dueOn: null }, TODAY)).toBe(false);
    expect(isOverdue({ status: "done", dueOn: "2026-10-20" }, TODAY)).toBe(false);
    expect(isOverdue({ status: "dropped", dueOn: "2026-10-20" }, TODAY)).toBe(false);
  });
});

describe("localToday", () => {
  it("reads the household-local calendar date of the instant, not the UTC date", () => {
    // 2026-10-24T17:00Z is 01:00 on 2026-10-25 in Taipei (Review Focus 3).
    expect(localToday("Asia/Taipei", Date.UTC(2026, 9, 24, 17, 0))).toBe("2026-10-25");
    expect(localToday("UTC", Date.UTC(2026, 9, 24, 17, 0))).toBe("2026-10-24");
  });
});

describe("active statuses", () => {
  it("treats open and in_progress as unfinished", () => {
    expect(TASK_ACTIVE_STATUSES).toEqual(["open", "in_progress"]);
    for (const status of TASK_ACTIVE_STATUSES) {
      expect(isActiveStatus(status)).toBe(true);
    }
    expect(isActiveStatus("done")).toBe(false);
    expect(isActiveStatus("dropped")).toBe(false);
  });

  it("buckets in_progress tasks like open ones", () => {
    // Same fields, same bucket as an open task: the status is not a second rule.
    expect(bucketOf(task({ status: "in_progress" }), ctx)).toBe("someday");
    expect(bucketOf(task({ status: "in_progress", scheduledOn: TODAY }), ctx)).toBe("today");
    expect(isOverdue({ status: "in_progress", dueOn: "2026-10-20" }, TODAY)).toBe(true);
    expect(isOverdue({ status: "in_progress", dueOn: TODAY }, TODAY)).toBe(false);
  });
});

describe("bucketOfIncludingClosed", () => {
  it("gives closed tasks a bucket only through bucketOfIncludingClosed", () => {
    const done = task({ status: "done", scheduledOn: "2026-10-21" });
    expect(bucketOf(done, ctx)).toBeNull();
    expect(bucketOfIncludingClosed(done, ctx)).toBe("today");
    const undatedDone = task({ status: "done" });
    expect(bucketOfIncludingClosed(undatedDone, ctx)).toBe("someday");
    expect(
      bucketOfIncludingClosed(task({ status: "dropped", dueOn: "2026-11-30" }), ctx),
    ).toBeNull();
  });

  it("applies the same earliest-anchor rule to a closed task", () => {
    // The later schedule must not hide the deadline that already passed.
    expect(
      bucketOfIncludingClosed(
        task({ status: "done", scheduledOn: "2026-10-26", dueOn: TODAY }),
        ctx,
      ),
    ).toBe("today");
    expect(bucketOfIncludingClosed(task({ status: "dropped" }), ctx)).toBe("someday");
  });
});

describe("priorityRank", () => {
  it("ranks priorities none < low < normal < high < urgent", () => {
    expect((["none", "low", "normal", "high", "urgent"] as const).map(priorityRank)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });
});
