import { describe, expect, it } from "vitest";
import {
  TASK_DRAG_TYPE,
  isTaskDrag,
  readTaskDrag,
  setTaskDragPayload,
  type DragTransfer,
} from "@/lib/ui/taskDrag";

function transfer(entries: Record<string, string> = {}): DragTransfer {
  const data = new Map(Object.entries(entries));
  return {
    get types() {
      return [...data.keys()];
    },
    getData: (type) => data.get(type) ?? "",
    setData: (type, value) => {
      data.set(type, value);
    },
    effectAllowed: "none",
    dropEffect: "none",
  };
}

describe("task drag payload", () => {
  it("stamps the row's id and current date under the custom type", () => {
    const data = transfer();
    setTaskDragPayload(data, { id: "t1", scheduledOn: "2026-10-20" });
    expect(data.getData(TASK_DRAG_TYPE)).toBe('{"id":"t1","scheduledOn":"2026-10-20"}');
    expect(data.effectAllowed).toBe("move");
  });

  it("keeps an unscheduled row's null date through the round trip", () => {
    const data = transfer();
    setTaskDragPayload(data, { id: "t1", scheduledOn: null });
    expect(readTaskDrag(data)).toEqual({ id: "t1", scheduledOn: null });
  });

  it("reads back the date the dragged row was showing (the undo source)", () => {
    const data = transfer();
    setTaskDragPayload(data, { id: "t1", scheduledOn: "2026-10-20" });
    expect(readTaskDrag(data)).toEqual({ id: "t1", scheduledOn: "2026-10-20" });
  });

  it("recognizes only the task type", () => {
    expect(isTaskDrag(transfer())).toBe(false);
    expect(isTaskDrag(transfer({ "text/plain": "t1" }))).toBe(false);
    expect(isTaskDrag(transfer({ [TASK_DRAG_TYPE]: "t1" }))).toBe(true);
    expect(isTaskDrag(null)).toBe(false);
  });

  it("rejects other drags, empty payloads and malformed payloads", () => {
    expect(readTaskDrag(transfer({ "text/plain": "t1" }))).toBeNull();
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: "" }))).toBeNull();
    expect(readTaskDrag(null)).toBeNull();
    // A raw id (an old wire format) is not a task payload.
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: "t1" }))).toBeNull();
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: "{" }))).toBeNull();
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: "null" }))).toBeNull();
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: '{"scheduledOn":null}' }))).toBeNull();
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: '{"id":""}' }))).toBeNull();
    // The previous date becomes a PATCH value, so its shape is validated too.
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: '{"id":"t1","scheduledOn":"20 Oct"}' }))).toBeNull();
    expect(
      readTaskDrag(transfer({ [TASK_DRAG_TYPE]: '{"id":"t1","scheduledOn":"2026-10-20T00:00"}' })),
    ).toBeNull();
  });
});
