import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { isUndoGesture, type UndoHotkeyEvent } from "@/lib/ui/useUndoHotkey";
import {
  clearUndo,
  peekUndo,
  pushUndo,
  undoAction,
  undoLast,
  type UndoAction,
} from "@/lib/ui/undo";

function make(label: string, undo: UndoAction["undo"] = () => undefined): UndoAction {
  return { label, undo: vi.fn(undo) };
}

function keydown(overrides: Partial<UndoHotkeyEvent> = {}): UndoHotkeyEvent {
  return {
    key: "z",
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

beforeEach(() => {
  clearUndo();
  vi.mocked(toast.error).mockClear();
});

describe("undoLast", () => {
  it("consumes the newest action first (LIFO) and reports an empty stack", async () => {
    const first = make("first");
    const second = make("second");
    pushUndo(first);
    pushUndo(second);

    expect(await undoLast()).toBe(true);
    expect(second.undo).toHaveBeenCalledTimes(1);
    expect(first.undo).not.toHaveBeenCalled();
    expect(peekUndo()).toBe("first");

    expect(await undoLast()).toBe(true);
    expect(first.undo).toHaveBeenCalledTimes(1);
    expect(peekUndo()).toBeNull();

    expect(await undoLast()).toBe(false);
  });
});

describe("undoAction", () => {
  it("reverts exactly the handled action and leaves the newer one in the stack", async () => {
    const first = make("first");
    const second = make("second");
    const firstHandle = pushUndo(first);
    pushUndo(second);

    expect(await undoAction(firstHandle)).toBe(true);
    expect(first.undo).toHaveBeenCalledTimes(1);
    expect(second.undo).not.toHaveBeenCalled();
    // The newer action is still undoable, both by handle and by LIFO.
    expect(peekUndo()).toBe("second");
    expect(await undoLast()).toBe(true);
    expect(second.undo).toHaveBeenCalledTimes(1);
    expect(peekUndo()).toBeNull();
  });

  it("is a no-op for a handle that was never pushed", async () => {
    const pushed = make("pushed");
    pushUndo(pushed);

    expect(await undoAction(make("stranger"))).toBe(false);
    expect(peekUndo()).toBe("pushed");
    expect(pushed.undo).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("is a no-op for an action that was already undone", async () => {
    const action = make("once");
    const handle = pushUndo(action);

    expect(await undoAction(handle)).toBe(true);
    expect(await undoAction(handle)).toBe(false);
    expect(action.undo).toHaveBeenCalledTimes(1);
    expect(peekUndo()).toBeNull();
  });

  it("does not accept a structurally equal copy of the handle", async () => {
    const action = make("original");
    const handle = pushUndo(action);

    expect(await undoAction({ ...handle })).toBe(false);
    expect(action.undo).not.toHaveBeenCalled();
    expect(await undoAction(handle)).toBe(true);
  });

  it("removes the action and toasts when its closure throws", async () => {
    const failing = make("failing", () => {
      throw new Error("Nope.");
    });
    const surviving = make("surviving");
    const handle = pushUndo(failing);
    pushUndo(surviving);

    expect(await undoAction(handle)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Nope.");
    expect(peekUndo()).toBe("surviving");
    expect(await undoAction(handle)).toBe(false);
    expect(failing.undo).toHaveBeenCalledTimes(1);
  });
});

describe("MAX_UNDO", () => {
  it("drops the oldest action at 20 and its handle stops matching", async () => {
    const actions = Array.from({ length: 21 }, (_, index) => make(`action-${index}`));
    const oldestHandle = pushUndo(actions[0]!);
    for (const action of actions.slice(1)) {
      pushUndo(action);
    }

    expect(peekUndo()).toBe("action-20");
    expect(await undoAction(oldestHandle)).toBe(false);
    expect(actions[0]!.undo).not.toHaveBeenCalled();

    let undone = 0;
    while (await undoLast()) {
      undone += 1;
    }
    expect(undone).toBe(20);
    expect(actions[1]!.undo).toHaveBeenCalledTimes(1);
  });
});

describe("clearUndo", () => {
  it("drops every handle", async () => {
    const action = make("pending");
    const handle = pushUndo(action);
    clearUndo();

    expect(peekUndo()).toBeNull();
    expect(await undoAction(handle)).toBe(false);
    expect(action.undo).not.toHaveBeenCalled();
  });
});

describe("useUndoHotkey gesture guard", () => {
  it("accepts plain z and exactly one of Ctrl/Cmd", () => {
    expect(isUndoGesture(keydown())).toBe(true);
    expect(isUndoGesture(keydown({ key: "Z" }))).toBe(true);
    expect(isUndoGesture(keydown({ ctrlKey: true }))).toBe(true);
    expect(isUndoGesture(keydown({ metaKey: true }))).toBe(true);
  });

  it("ignores a held key so one hold cannot drain the undo stack", () => {
    // Without the repeat guard, holding z fires up to the 20-action cap.
    expect(isUndoGesture(keydown({ repeat: true }))).toBe(false);
    expect(isUndoGesture(keydown({ repeat: true, ctrlKey: true }))).toBe(false);
    expect(isUndoGesture(keydown({ repeat: true, metaKey: true }))).toBe(false);
  });

  it("keeps rejecting other keys, extra modifiers and both Ctrl+Meta at once", () => {
    expect(isUndoGesture(keydown({ key: "x" }))).toBe(false);
    expect(isUndoGesture(keydown({ altKey: true }))).toBe(false);
    expect(isUndoGesture(keydown({ shiftKey: true }))).toBe(false);
    expect(isUndoGesture(keydown({ ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isUndoGesture(keydown({ ctrlKey: true, altKey: true }))).toBe(false);
  });
});
