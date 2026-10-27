import { describe, expect, it } from "vitest";
import {
  resolveSomedayTriage,
  resolveTaskShortcut,
  type TaskShortcutAction,
} from "@/lib/ui/useTaskShortcuts";

/** A KeyboardEvent-shaped object: the resolver reads keys/flags only, never the DOM. */
function keyEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    ...init,
  } as KeyboardEvent;
}

function resolve(key: string, init: Partial<KeyboardEvent> = {}): TaskShortcutAction | null {
  return resolveTaskShortcut(keyEvent(key, init));
}

describe("resolveTaskShortcut", () => {
  it("maps the triage keys", () => {
    expect(resolve("j")).toEqual({ kind: "move", delta: 1 });
    expect(resolve("k")).toEqual({ kind: "move", delta: -1 });
    expect(resolve("1")).toEqual({ kind: "bucket", bucket: 1 });
    expect(resolve("2")).toEqual({ kind: "bucket", bucket: 2 });
    expect(resolve("3")).toEqual({ kind: "bucket", bucket: 3 });
    expect(resolve("4")).toEqual({ kind: "next-list" });
    expect(resolve("x")).toEqual({ kind: "complete" });
    expect(resolve("Enter")).toEqual({ kind: "open" });
    expect(resolve("?")).toEqual({ kind: "help" });
    expect(resolve("Escape")).toEqual({ kind: "escape" });
  });

  it("accepts caps-lock style uppercase letters without shift", () => {
    expect(resolve("J")).toEqual({ kind: "move", delta: 1 });
    expect(resolve("K")).toEqual({ kind: "move", delta: -1 });
    expect(resolve("X")).toEqual({ kind: "complete" });
  });

  it("ignores every modifier combination", () => {
    expect(resolve("j", { ctrlKey: true })).toBeNull();
    expect(resolve("j", { metaKey: true })).toBeNull();
    expect(resolve("j", { altKey: true })).toBeNull();
    expect(resolve("1", { ctrlKey: true })).toBeNull();
    expect(resolve("?", { metaKey: true })).toBeNull();
  });

  it("ignores held-key repeats", () => {
    expect(resolve("j", { repeat: true })).toBeNull();
    expect(resolve("x", { repeat: true })).toBeNull();
  });

  it("leaves shifted gestures other than ? to the browser", () => {
    expect(resolve("J", { shiftKey: true })).toBeNull();
    expect(resolve("j", { shiftKey: true })).toBeNull();
    expect(resolve("1", { shiftKey: true })).toBeNull();
    expect(resolve("Enter", { shiftKey: true })).toBeNull();
    expect(resolve("?", { shiftKey: true })).toEqual({ kind: "help" });
  });

  it("returns null for keys the task layer does not own", () => {
    expect(resolve("c")).toBeNull();
    expect(resolve("t")).toBeNull();
    expect(resolve("5")).toBeNull();
    expect(resolve("/")).toBeNull();
    expect(resolve("ArrowDown")).toBeNull();
  });
});

describe("resolveSomedayTriage", () => {
  it("clears the due date when one is set", () => {
    expect(resolveSomedayTriage({ dueOn: "2026-10-26", dueTime: null })).toEqual({
      kind: "clear-due",
    });
    expect(resolveSomedayTriage({ dueOn: "2026-10-26", dueTime: "18:30" })).toEqual({
      kind: "clear-due",
    });
    expect(resolveSomedayTriage({ dueOn: "2026-10-30", dueTime: null })).toEqual({
      kind: "clear-due",
    });
  });

  it("clears on a stray time too, so no time can outlive its date", () => {
    // The service rejects a time without a date, so this is not a stored state;
    // the pure decision table still treats any residue as work for `3` to clear.
    expect(resolveSomedayTriage({ dueOn: null, dueTime: "18:30" })).toEqual({
      kind: "clear-due",
    });
  });

  it("reports an undated task as already in Someday", () => {
    // The Inbox is no longer a bucket, so there is no list to file it into and
    // no "already unscheduled" outcome: the row is simply already Someday.
    expect(resolveSomedayTriage({ dueOn: null, dueTime: null })).toEqual({
      kind: "already-someday",
    });
  });
});
