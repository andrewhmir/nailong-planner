import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  createCollection,
  deleteCollection,
  getCollectionAccess,
  listCollectionTree,
  resolveShade,
  updateCollection,
} from "@/lib/services/collections";
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
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      expect(root.parentId).toBeNull();
      expect(root.shadeIndex).toBe(3);

      const first = createCollection(db, ctxA, { name: "Math", parentId: root.id });
      const second = createCollection(db, ctxA, { name: "Biology", parentId: root.id });
      const third = createCollection(db, ctxA, { name: "History", parentId: root.id });

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
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      createCollection(db, ctxA, { name: "Math", parentId: root.id });
      const second = createCollection(db, ctxA, { name: "Biology", parentId: root.id });
      expect(second.shadeIndex).toBe(2);

      deleteCollection(db, ctxA, second.id);
      const replacement = createCollection(db, ctxA, { name: "Chemistry", parentId: root.id });
      expect(replacement.shadeIndex).toBe(2);
    } finally {
      close();
    }
  });

  it("rejects an eighth sub-calendar with a conflict", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      for (let i = 0; i < 7; i += 1) {
        createCollection(db, ctxA, { name: `Subject ${i}`, parentId: root.id });
      }
      expectAppError(
        () => createCollection(db, ctxA, { name: "Eighth", parentId: root.id }),
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
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      const child = createCollection(db, ctxA, { name: "Math", parentId: root.id });

      expectAppError(
        () => createCollection(db, ctxA, { name: "Algebra", parentId: child.id }),
        "VALIDATION",
        400,
      );

      const foreignRoot = createCollection(db, ctxOther, { name: "Theirs", hueFamily: "rose" });
      expectAppError(
        () => createCollection(db, ctxA, { name: "Sneaky", parentId: foreignRoot.id }),
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
      expectAppError(() => createCollection(db, ctxA, { name: "No Color" }), "VALIDATION", 400);
      expectAppError(
        () => createCollection(db, ctxA, { name: "For Them", hueFamily: "rose", ownerId: "user-b" }),
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
          createCollection(db, ctxA, {
            name: "Secret",
            hueFamily: "slate",
            visibility: "view_only",
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
      const work = createCollection(db, ctxA, { name: "Work", hueFamily: "amber", ownerId: "user-a" });
      const updated = updateCollection(db, ctxA, work.id, { visibility: "view_only" });
      expect(updated.visibility).toBe("view_only");

      expectAppError(() => updateCollection(db, ctxB, work.id, { name: "Hacked" }), "FORBIDDEN", 403);
      expectAppError(() => deleteCollection(db, ctxB, work.id), "FORBIDDEN", 403);
      expectAppError(
        () => updateCollection(db, ctxB, work.id, { visibility: "shared" }),
        "FORBIDDEN",
        403,
      );
      expect(updateCollection(db, ctxA, work.id, { name: "Work 2026" }).name).toBe("Work 2026");
    } finally {
      close();
    }
  });

  it("carries an owner move down to the sub-calendars", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      // The pre-fix import tree: root and children all shared.
      const root = createCollection(db, ctxA, { name: "From Google", hueFamily: "teal" });
      const child = createCollection(db, ctxA, { name: "Family", parentId: root.id });
      createCollection(db, ctxA, { name: "Work", parentId: root.id });

      const updated = updateCollection(db, ctxA, root.id, { ownerId: "user-a" });
      expect(updated.ownerId).toBe("user-a");

      const node = listCollectionTree(db, ctxA).find((row) => row.id === root.id)!;
      expect(node.children).toHaveLength(2);
      expect(node.children.every((row) => row.ownerId === "user-a")).toBe(true);
      expect(getCollectionAccess(db, ctxA, child.id).effective.ownerId).toBe("user-a");

      // Giving it back to the household carries the return down as well.
      updateCollection(db, ctxA, root.id, { ownerId: null });
      const sharedNode = listCollectionTree(db, ctxA).find((row) => row.id === root.id)!;
      expect(sharedNode.children.every((row) => row.ownerId === null)).toBe(true);
    } finally {
      close();
    }
  });

  it("refuses to change a sub-calendar's owner directly", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCollection(db, ctxA, { name: "Household", hueFamily: "teal" });
      const child = createCollection(db, ctxA, { name: "Chores", parentId: root.id });

      expectAppError(
        () => updateCollection(db, ctxA, child.id, { ownerId: "user-a" }),
        "VALIDATION",
        400,
      );
      expect(getCollectionAccess(db, ctxA, child.id).effective.ownerId).toBeNull();
    } finally {
      close();
    }
  });

  it("re-derives child shades when the root hue changes", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      const child = createCollection(db, ctxA, { name: "Math", parentId: root.id });

      const before = resolveShade(db, child);
      updateCollection(db, ctxA, root.id, { hueFamily: "teal" });
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
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      createCollection(db, ctxA, { name: "Math", parentId: root.id });
      expect(listCollectionTree(db, ctxA)).toHaveLength(1);

      deleteCollection(db, ctxA, root.id);
      expect(listCollectionTree(db, ctxA)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("never returns another household's calendars", async () => {
    const { db, close, ctxA, ctxOther } = await makeSeededDb();
    try {
      createCollection(db, ctxA, { name: "Mine", hueFamily: "teal" });
      createCollection(db, ctxOther, { name: "Theirs", hueFamily: "rose" });

      expect(listCollectionTree(db, ctxA).map((calendar) => calendar.name)).toEqual(["Mine"]);
      expect(listCollectionTree(db, ctxOther).map((calendar) => calendar.name)).toEqual(["Theirs"]);
    } finally {
      close();
    }
  });
});
