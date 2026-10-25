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
  it("stamps the custom type and a move effect on the source", () => {
    const data = transfer();
    setTaskDragPayload(data, "t1");
    expect(data.getData(TASK_DRAG_TYPE)).toBe("t1");
    expect(data.effectAllowed).toBe("move");
  });

  it("recognizes only the task type", () => {
    expect(isTaskDrag(transfer())).toBe(false);
    expect(isTaskDrag(transfer({ "text/plain": "t1" }))).toBe(false);
    expect(isTaskDrag(transfer({ [TASK_DRAG_TYPE]: "t1" }))).toBe(true);
    expect(isTaskDrag(null)).toBe(false);
  });

  it("reads the id back and rejects other drags or empty payloads", () => {
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: "t1" }))).toBe("t1");
    expect(readTaskDrag(transfer({ "text/plain": "t1" }))).toBeNull();
    expect(readTaskDrag(transfer({ [TASK_DRAG_TYPE]: "" }))).toBeNull();
    expect(readTaskDrag(null)).toBeNull();
  });
});
