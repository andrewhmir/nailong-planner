import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_SCOPE,
  DEFAULT_TASK_VIEW_STATE,
  mergeTaskScopeParams,
  mergeTaskViewParams,
  parseTaskScope,
  parseTaskViewState,
  type TaskViewState,
} from "@/lib/ui/taskViewParams";

/**
 * The `/tasks` URL codec (spec §6 + ruling 29). The default state is what a bare
 * `/tasks` renders, every toolbar control maps to exactly one param, and the
 * scope codec owns `view`: absent means All, and All never writes the param.
 * `?task=` belongs to the page and survives every merge.
 */

describe("parseTaskViewState", () => {
  it("defaults to list/status/manual, closed hidden, no filters", () => {
    expect(parseTaskViewState(new URLSearchParams("view=today"))).toEqual(DEFAULT_TASK_VIEW_STATE);
  });

  it("parses valid params and drops unknown values", () => {
    const parsed = parseTaskViewState(
      new URLSearchParams(
        "layout=board&group=priority&sort=due&closed=1&status=open,in_progress,bogus&priority=urgent&list=l1",
      ),
    );

    expect(parsed).toMatchObject({
      layout: "board",
      group: "priority",
      sort: "due",
      closed: true,
      status: ["open", "in_progress"],
      priority: ["urgent"],
      collectionId: "l1",
    });
  });

  it("collapses duplicate filter values and keeps their first-seen order", () => {
    const parsed = parseTaskViewState(
      new URLSearchParams("status=open,done,open,done&priority=high,urgent,high"),
    );

    expect(parsed.status).toEqual(["open", "done"]);
    expect(parsed.priority).toEqual(["high", "urgent"]);
  });

  it("falls back to the defaults for unknown layout/group/sort values", () => {
    const parsed = parseTaskViewState(
      new URLSearchParams(
        "layout=grid&group=due&sort=alphabetical&closed=0&status=bogus&priority=bogus&list=",
      ),
    );

    expect(parsed).toEqual(DEFAULT_TASK_VIEW_STATE);
  });
});

describe("parseTaskScope", () => {
  it("defaults to All for an absent, unknown or retired view", () => {
    expect(DEFAULT_TASK_SCOPE).toBe("all");
    expect(parseTaskScope(new URLSearchParams(""))).toBe("all");
    expect(parseTaskScope(new URLSearchParams("view=later"))).toBe("all");
    // `inbox` is retired as a scope: an old bookmark opens All (the API 400s it).
    expect(parseTaskScope(new URLSearchParams("view=inbox"))).toBe("all");
  });

  it("reads every valid scope", () => {
    for (const scope of ["all", "today", "week", "someday"] as const) {
      expect(parseTaskScope(new URLSearchParams(`view=${scope}`))).toBe(scope);
    }
  });
});

describe("mergeTaskScopeParams", () => {
  it("deletes view for All and keeps the other params", () => {
    const base = new URLSearchParams("view=today&task=t1&layout=board");
    const merged = mergeTaskScopeParams(base, "all");

    expect(merged).not.toBe(base);
    expect(merged.get("view")).toBeNull();
    expect(merged.get("task")).toBe("t1");
    expect(merged.get("layout")).toBe("board");
    // Never mutates the caller's params.
    expect(base.get("view")).toBe("today");
  });

  it("writes today/week/someday and round-trips through parse", () => {
    for (const scope of ["today", "week", "someday"] as const) {
      const merged = mergeTaskScopeParams(new URLSearchParams("task=t1"), scope);
      expect(merged.get("view")).toBe(scope);
      expect(merged.get("task")).toBe("t1");
      expect(parseTaskScope(merged)).toBe(scope);
    }
  });

  it("clears a stale view when switching back to All", () => {
    expect(mergeTaskScopeParams(new URLSearchParams("view=week&task=t1"), "all").toString()).toBe(
      "task=t1",
    );
  });
});

describe("mergeTaskViewParams", () => {
  it("omits defaults and preserves view/task when merging", () => {
    const base = new URLSearchParams("view=today&task=t1");
    const merged = mergeTaskViewParams(base, DEFAULT_TASK_VIEW_STATE);

    expect(merged).not.toBe(base);
    expect(merged.get("view")).toBe("today");
    expect(merged.get("task")).toBe("t1");
    expect(merged.get("layout")).toBeNull();
    expect(merged.get("group")).toBeNull();
    expect(merged.get("sort")).toBeNull();
    expect(merged.get("closed")).toBeNull();
    expect(merged.get("status")).toBeNull();
    expect(merged.get("priority")).toBeNull();
    expect(merged.get("list")).toBeNull();
    // Merging never mutates the caller's params.
    expect(base.toString()).toBe("view=today&task=t1");
  });

  it("writes the non-default state and round-trips through parse", () => {
    const state: TaskViewState = {
      layout: "board",
      group: "priority",
      sort: "due",
      closed: true,
      status: ["open", "in_progress"],
      priority: ["urgent", "high"],
      collectionId: "list-1",
    };

    const merged = mergeTaskViewParams(new URLSearchParams("view=today&task=t1"), state);

    expect(merged.get("layout")).toBe("board");
    expect(merged.get("group")).toBe("priority");
    expect(merged.get("sort")).toBe("due");
    expect(merged.get("closed")).toBe("1");
    expect(merged.get("status")).toBe("open,in_progress");
    expect(merged.get("priority")).toBe("urgent,high");
    expect(merged.get("list")).toBe("list-1");
    expect(merged.get("view")).toBe("today");
    expect(merged.get("task")).toBe("t1");
    expect(parseTaskViewState(merged)).toEqual(state);
  });

  it("replaces stale managed params from the base", () => {
    const merged = mergeTaskViewParams(
      new URLSearchParams(
        "view=someday&task=t2&layout=board&group=priority&sort=due&closed=1&status=done&priority=low&list=old",
      ),
      DEFAULT_TASK_VIEW_STATE,
    );

    for (const key of ["layout", "group", "sort", "closed", "status", "priority", "list"]) {
      expect(merged.get(key)).toBeNull();
    }
    expect(merged.get("view")).toBe("someday");
    expect(merged.get("task")).toBe("t2");
  });
});
