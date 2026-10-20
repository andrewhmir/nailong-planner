import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  createCalendar,
  deleteCalendar,
  listCalendarTree,
  resolveShade,
  updateCalendar,
} from "@/lib/services/calendars";
import { makeSeededDb } from "../helpers/fixtures";

function expectAppError(fn: () => unknown, code: string, status: number) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    expect((error as AppError).status).toBe(status);
    return;
  }
  throw new Error(`expected AppError ${code}, but call succeeded`);
}

describe("calendar service", () => {
  it("creates a root calendar and assigns child shades in the documented order", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      expect(root.parentId).toBeNull();
      expect(root.shadeIndex).toBe(3);

      const first = createCalendar(db, ctxA, { name: "Math", parentId: root.id });
      const second = createCalendar(db, ctxA, { name: "Biology", parentId: root.id });
      const third = createCalendar(db, ctxA, { name: "History", parentId: root.id });

      expect([first.shadeIndex, second.shadeIndex, third.shadeIndex]).toEqual([4, 2, 5]);
      expect(first.hueFamily).toBeNull();
      expect(first.ownerId).toBeNull();
    } finally {
      close();
    }
  });

  it("reuses the shade of a deleted child", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      createCalendar(db, ctxA, { name: "Math", parentId: root.id });
      const second = createCalendar(db, ctxA, { name: "Biology", parentId: root.id });
      expect(second.shadeIndex).toBe(2);

      deleteCalendar(db, ctxA, second.id);
      const replacement = createCalendar(db, ctxA, { name: "Chemistry", parentId: root.id });
      expect(replacement.shadeIndex).toBe(2);
    } finally {
      close();
    }
  });

  it("rejects an eighth sub-calendar with a conflict", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      for (let i = 0; i < 7; i += 1) {
        createCalendar(db, ctxA, { name: `Subject ${i}`, parentId: root.id });
      }
      expectAppError(
        () => createCalendar(db, ctxA, { name: "Eighth", parentId: root.id }),
        "CONFLICT",
        409,
      );
    } finally {
      close();
    }
  });

  it("rejects grandchildren and cross-household parents", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      const child = createCalendar(db, ctxA, { name: "Math", parentId: root.id });

      expectAppError(
        () => createCalendar(db, ctxA, { name: "Algebra", parentId: child.id }),
        "VALIDATION",
        400,
      );

      const foreignRoot = createCalendar(db, ctxOther, { name: "Theirs", hueFamily: "rose" });
      expectAppError(
        () => createCalendar(db, ctxA, { name: "Sneaky", parentId: foreignRoot.id }),
        "NOT_FOUND",
        404,
      );
    } finally {
      close();
    }
  });

  it("requires a hue family on roots and rejects a partner-owned root", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      expectAppError(() => createCalendar(db, ctxA, { name: "No Color" }), "VALIDATION", 400);
      expectAppError(
        () => createCalendar(db, ctxA, { name: "For Them", hueFamily: "rose", ownerId: "user-b" }),
        "FORBIDDEN",
        403,
      );
    } finally {
      close();
    }
  });

  it("refuses to make an ownerless calendar view-only", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      expectAppError(
        () =>
          createCalendar(db, ctxA, {
            name: "Secret",
            hueFamily: "slate",
            isViewOnlyForPartner: true,
          }),
        "VALIDATION",
        400,
      );
    } finally {
      close();
    }
  });

  it("lets the owner mark their calendar view-only and blocks the partner from writing it", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const work = createCalendar(db, ctxA, { name: "Work", hueFamily: "amber", ownerId: "user-a" });
      const updated = updateCalendar(db, ctxA, work.id, { isViewOnlyForPartner: true });
      expect(updated.isViewOnlyForPartner).toBe(1);

      expectAppError(() => updateCalendar(db, ctxB, work.id, { name: "Hacked" }), "FORBIDDEN", 403);
      expectAppError(() => deleteCalendar(db, ctxB, work.id), "FORBIDDEN", 403);
      expectAppError(
        () => updateCalendar(db, ctxB, work.id, { isViewOnlyForPartner: false }),
        "FORBIDDEN",
        403,
      );
      expect(updateCalendar(db, ctxA, work.id, { name: "Work 2026" }).name).toBe("Work 2026");
    } finally {
      close();
    }
  });

  it("re-derives child shades when the root hue changes", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      const child = createCalendar(db, ctxA, { name: "Math", parentId: root.id });

      const before = resolveShade(db, child);
      updateCalendar(db, ctxA, root.id, { hueFamily: "teal" });
      const after = resolveShade(db, child);

      expect(before.main).toContain("275");
      expect(after.main).toContain("190");
      expect(after.main).toBe(`oklch(0.58 0.09 190)`);
      expect(child.hueFamily).toBeNull();
    } finally {
      close();
    }
  });

  it("deleting a root removes its children from the tree", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCalendar(db, ctxA, { name: "School", hueFamily: "indigo" });
      createCalendar(db, ctxA, { name: "Math", parentId: root.id });
      expect(listCalendarTree(db, ctxA)).toHaveLength(1);

      deleteCalendar(db, ctxA, root.id);
      expect(listCalendarTree(db, ctxA)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("never returns another household's calendars", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      createCalendar(db, ctxA, { name: "Mine", hueFamily: "teal" });
      createCalendar(db, ctxOther, { name: "Theirs", hueFamily: "rose" });

      expect(listCalendarTree(db, ctxA).map((calendar) => calendar.name)).toEqual(["Mine"]);
      expect(listCalendarTree(db, ctxOther).map((calendar) => calendar.name)).toEqual(["Theirs"]);
    } finally {
      close();
    }
  });
});
