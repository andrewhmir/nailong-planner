import { describe, expect, it } from "vitest";
import type { TaskRow } from "@/lib/db/schema";
import {
  bucketOf,
  endOfWeek,
  isOverdue,
  localToday,
  TASK_BUCKETS,
  type BucketContext,
  type TaskBucket,
} from "@/lib/domain/tasks";

/**
 * Derived task buckets (spec D6). Every expectation is pinned to real calendar
 * dates: 2026-10-21 is a Wednesday and 2026-10-25 is a Sunday. A Sunday-started
 * week ends on Saturday 2026-10-31; a Monday-started week ends on Sunday
 * 2026-10-25, because Sunday is its seventh and last day. The bucket anchor is
 * the earliest of `scheduledOn`/`dueOn`, so a past-due task is never stranded
 * by a later schedule.
 */

const TODAY = "2026-10-21";
const END_OF_WEEK = "2026-10-25";
const INBOX_ID = "list-inbox";
const PROJECT_ID = "list-project";

const ctx: BucketContext = { today: TODAY, endOfWeek: END_OF_WEEK, inboxId: INBOX_ID };

type BucketFields = Pick<TaskRow, "status" | "scheduledOn" | "dueOn" | "collectionId">;

function task(overrides: Partial<BucketFields> = {}): BucketFields {
  return {
    status: overrides.status ?? "open",
    scheduledOn: overrides.scheduledOn ?? null,
    dueOn: overrides.dueOn ?? null,
    collectionId: overrides.collectionId ?? PROJECT_ID,
  };
}

function bucketOfTask(overrides: Partial<BucketFields> = {}): TaskBucket | null {
  return bucketOf(task(overrides), ctx);
}

describe("TASK_BUCKETS", () => {
  it("lists the four triage views in rail order", () => {
    expect(TASK_BUCKETS).toEqual(["inbox", "today", "week", "someday"]);
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
    expect(bucketOfTask({ status: "done", collectionId: INBOX_ID })).toBeNull();
  });

  it("separates undated inbox work from undated project work", () => {
    expect(bucketOfTask({ collectionId: INBOX_ID })).toBe("inbox");
    expect(bucketOfTask({ collectionId: PROJECT_ID })).toBe("someday");
  });

  it("moves a dated inbox task out of the inbox (the D6 fallback)", () => {
    expect(bucketOfTask({ collectionId: INBOX_ID, dueOn: TODAY })).toBe("today");
    expect(bucketOfTask({ collectionId: INBOX_ID, scheduledOn: "2026-10-23" })).toBe("week");
  });

  it("puts scheduled work dated today or earlier in today", () => {
    expect(bucketOfTask({ scheduledOn: TODAY })).toBe("today");
    expect(bucketOfTask({ scheduledOn: "2026-10-20" })).toBe("today");
  });

  it("puts a due-only project task in today or week, not someday", () => {
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
    // A later schedule must not hide work that is already due or overdue, and
    // the deadline alone is a commitment when nothing scheduled the task.
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
