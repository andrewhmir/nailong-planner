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
  it("clears both dates when either one is set", () => {
    expect(resolveSomedayTriage({ scheduledOn: "2026-10-26", dueOn: null })).toEqual({
      kind: "clear-dates",
    });
    expect(resolveSomedayTriage({ scheduledOn: null, dueOn: "2026-10-30" })).toEqual({
      kind: "clear-dates",
    });
    expect(resolveSomedayTriage({ scheduledOn: "2026-10-26", dueOn: "2026-10-30" })).toEqual({
      kind: "clear-dates",
    });
  });

  it("reports an undated task as already in Someday", () => {
    // The Inbox is no longer a bucket, so there is no list to file it into and
    // no "already unscheduled" outcome: the row is simply already Someday.
    expect(resolveSomedayTriage({ scheduledOn: null, dueOn: null })).toEqual({
      kind: "already-someday",
    });
  });
});
