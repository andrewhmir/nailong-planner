import { describe, expect, it } from "vitest";
import {
  BOARD_DRAG_TYPE,
  readBoardDragPayload,
  setBoardDragPayload,
  type BoardDragTransfer,
} from "@/lib/ui/taskBoardDrag";

function transfer(entries: Record<string, string> = {}): BoardDragTransfer {
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

describe("board drag payload", () => {
  it("stamps the dragged card's id under the board's own type and advertises a move", () => {
    const data = transfer();
    setBoardDragPayload(data, "t1");
    expect(data.getData(BOARD_DRAG_TYPE)).toBe("t1");
    expect(data.effectAllowed).toBe("move");
  });

  it("round-trips the card id", () => {
    const data = transfer();
    setBoardDragPayload(data, "task-42");
    expect(readBoardDragPayload(data)).toBe("task-42");
  });

  it("reads only the board type, not the calendar's task-row type or plain text", () => {
    expect(readBoardDragPayload(transfer())).toBeNull();
    expect(readBoardDragPayload(transfer({ "text/plain": "t1" }))).toBeNull();
    // The row→day drag payload is a different contract and must never move a card.
    expect(readBoardDragPayload(transfer({ "text/x-nailong-task": '{"id":"t1"}' }))).toBeNull();
  });

  it("treats an empty or whitespace-only payload as no task", () => {
    // Some browsers expose the type on `dragover` but withhold the data, and a
    // hand-crafted `setData(type, "   ")` carries nothing usable; both are null.
    expect(readBoardDragPayload(transfer({ [BOARD_DRAG_TYPE]: "" }))).toBeNull();
    expect(readBoardDragPayload(transfer({ [BOARD_DRAG_TYPE]: "   " }))).toBeNull();
  });

  it("trims a padded payload back to the id", () => {
    expect(readBoardDragPayload(transfer({ [BOARD_DRAG_TYPE]: "  t1\t" }))).toBe("t1");
  });

  it("returns null for a missing transfer", () => {
    expect(readBoardDragPayload(null)).toBeNull();
    expect(readBoardDragPayload(undefined)).toBeNull();
  });
});
