import { describe, expect, it } from "vitest";
import { taskChip, TASK_FC_ID_PREFIX } from "@/components/calendar/taskChip";
import { PARENT_SHADE_INDEX, shadeTokens } from "@/lib/color/palette";
import type { TaskView } from "@/lib/services/tasks";

const TEAL = shadeTokens("teal", 4);

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: "t1",
    householdId: "h1",
    collectionId: "c1",
    title: "Buy milk",
    notes: null,
    status: "open",
    scheduledOn: "2026-10-20",
    dueOn: null,
    completedAt: null,
    droppedAt: null,
    sortOrder: 0,
    createdBy: "u1",
    createdAt: 0,
    updatedAt: 0,
    checklist: [],
    collection: {
      id: "c1",
      name: "Errands",
      kind: "list",
      hueFamily: "teal",
      shadeIndex: 4,
    },
    ...overrides,
  } as TaskView;
}

describe("taskChip", () => {
  it("maps a scheduled task to an all-day FullCalendar chip", () => {
    const chip = taskChip(task());
    expect(chip).not.toBeNull();
    expect(chip!.id).toBe(`${TASK_FC_ID_PREFIX}t1`);
    expect(chip!.title).toBe("Buy milk");
    expect(chip!.allDay).toBe(true);
    expect(chip!.start).toBe("2026-10-20");
    // FullCalendar's end is exclusive: a one-day task ends the next day.
    expect(chip!.end).toBe("2026-10-21");
    expect(chip!.classNames).toContain("fc-task-chip");
  });

  it("crosses the month boundary for the exclusive end", () => {
    expect(taskChip(task({ scheduledOn: "2026-10-31" }))!.end).toBe("2026-11-01");
    expect(taskChip(task({ scheduledOn: "2026-12-31" }))!.end).toBe("2027-01-01");
  });

  it("produces only scheduled tasks", () => {
    const chips = [
      task({ id: "t1", scheduledOn: "2026-10-20" }),
      task({ id: "t2", scheduledOn: null }),
      task({ id: "t3", scheduledOn: "2026-10-21" }),
    ]
      .map(taskChip)
      .filter((chip) => chip !== null);
    expect(chips.map((chip) => chip.id)).toEqual(["task:t1", "task:t3"]);
  });

  it("is read-only: no drag and no resize", () => {
    const chip = taskChip(task())!;
    expect(chip.editable).toBe(false);
    expect(chip.durationEditable).toBe(false);
  });

  it("carries the task contract in extendedProps", () => {
    const chip = taskChip(task())!;
    expect(chip.extendedProps).toMatchObject({
      kind: "task",
      taskId: "t1",
      collectionId: "c1",
      collectionName: "Errands",
      completed: false,
      ariaLabel: "Task: Buy milk",
    });
  });

  it("takes the accent from the owning collection's shade", () => {
    const chip = taskChip(task())!;
    expect(chip.extendedProps.accent).toBe(TEAL.mainHex);
    expect(chip.extendedProps.collectionName).toBe("Errands");
  });

  it("falls back to the neutral parent shade for a legacy collection", () => {
    const chip = taskChip(
      task({
        collection: {
          id: "c1",
          name: "Legacy",
          kind: "list",
          hueFamily: null,
          shadeIndex: 0,
        },
      }),
    )!;
    expect(chip.extendedProps.accent).toBe(shadeTokens("slate", PARENT_SHADE_INDEX).mainHex);
  });
});
