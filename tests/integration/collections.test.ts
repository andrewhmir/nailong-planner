import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  createCollection,
  deleteCollection,
  ensureInbox,
  getCollection,
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

function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected AppError, but call succeeded");
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

  it("hides a private list and its subtree from the partner on every path", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const journal = createCollection(db, ctxA, {
        name: "Journal",
        kind: "list",
        hueFamily: "rose",
        ownerId: "user-a",
        visibility: "private",
      });
      const entries = createCollection(db, ctxA, { name: "Entries", parentId: journal.id });
      expect(entries.kind).toBe("list");

      const mine = listCollectionTree(db, ctxA).find((node) => node.id === journal.id);
      expect(mine?.children.map((child) => child.id)).toEqual([entries.id]);

      const theirs = listCollectionTree(db, ctxB);
      expect(theirs.map((node) => node.name)).not.toContain("Journal");
      expect(theirs.flatMap((node) => node.children).map((child) => child.id)).not.toContain(
        entries.id,
      );

      expectAppError(() => getCollection(db, ctxB, journal.id), "NOT_FOUND", 404);
      expectAppError(() => getCollectionAccess(db, ctxB, journal.id), "NOT_FOUND", 404);
      expectAppError(() => getCollection(db, ctxB, entries.id), "NOT_FOUND", 404);
      expectAppError(
        () => updateCollection(db, ctxB, journal.id, { name: "Mine now" }),
        "NOT_FOUND",
        404,
      );
      expectAppError(() => deleteCollection(db, ctxB, journal.id), "NOT_FOUND", 404);

      expect(getCollection(db, ctxA, journal.id).name).toBe("Journal");
      expect(updateCollection(db, ctxA, journal.id, { name: "Journal 2026" }).name).toBe(
        "Journal 2026",
      );
    } finally {
      close();
    }
  });

  it("keeps a view-only list readable for the partner but blocks every write", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const plan = createCollection(db, ctxA, {
        name: "House plan",
        kind: "list",
        hueFamily: "teal",
        ownerId: "user-a",
        visibility: "view_only",
      });

      expect(listCollectionTree(db, ctxB).map((node) => node.id)).toEqual([plan.id]);
      expect(getCollection(db, ctxB, plan.id).id).toBe(plan.id);
      expectAppError(
        () => updateCollection(db, ctxB, plan.id, { name: "Hacked" }),
        "FORBIDDEN",
        403,
      );
      expectAppError(() => deleteCollection(db, ctxB, plan.id), "FORBIDDEN", 403);
    } finally {
      close();
    }
  });

  it("lets a member rename and recolour an ownerless collection without changing its access", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const ours = createCollection(db, ctxA, { name: "Ours", hueFamily: "teal" });
      // The dialog's edit payload always carries the stored owner (null for
      // "Ours") and visibility (shared); neither is an access change.
      const updated = updateCollection(db, ctxA, ours.id, {
        name: "Household",
        hueFamily: "amber",
        ownerId: null,
        visibility: "shared",
      });
      expect(updated).toMatchObject({
        name: "Household",
        hueFamily: "amber",
        ownerId: null,
        visibility: "shared",
      });
      expect(getCollection(db, ctxA, ours.id).visibility).toBe("shared");
      // Any household member may edit an ownerless row; this is the sidebar's
      // rename path for the seeded shared lists.
      expect(updateCollection(db, ctxB, ours.id, { name: "Ours again" }).name).toBe("Ours again");
    } finally {
      close();
    }
  });

  it("lets the owner give a view-only collection back to Ours despite the echoed visibility", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const plan = createCollection(db, ctxA, {
        name: "House plan",
        kind: "list",
        hueFamily: "teal",
        ownerId: "user-a",
        visibility: "view_only",
      });

      // The dialog sends the stored visibility alongside `ownerId: null`; the
      // explicit un-owning wins and resets it to shared.
      const given = updateCollection(db, ctxA, plan.id, {
        ownerId: null,
        visibility: "view_only",
      });
      expect(given).toMatchObject({ ownerId: null, visibility: "shared" });
    } finally {
      close();
    }
  });

  it("still stops the partner un-owning or flipping a view-only collection", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const plan = createCollection(db, ctxA, {
        name: "House plan",
        kind: "list",
        hueFamily: "teal",
        ownerId: "user-a",
        visibility: "view_only",
      });

      // `assertWritable` rejects every partner write before the owner check.
      expectAppError(
        () => updateCollection(db, ctxB, plan.id, { ownerId: null }),
        "FORBIDDEN",
        403,
      );
      expectAppError(
        () => updateCollection(db, ctxB, plan.id, { ownerId: null, visibility: "view_only" }),
        "FORBIDDEN",
        403,
      );
      expectAppError(
        () => updateCollection(db, ctxB, plan.id, { visibility: "shared" }),
        "FORBIDDEN",
        403,
      );
      expect(getCollection(db, ctxA, plan.id)).toMatchObject({
        ownerId: "user-a",
        visibility: "view_only",
      });
    } finally {
      close();
    }
  });

  it("rejects view-only on an ownerless collection with 400, not 403", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const shared = createCollection(db, ctxA, { name: "Shared", hueFamily: "teal" });
      const error = catchAppError(() =>
        updateCollection(db, ctxA, shared.id, { visibility: "view_only" }),
      );
      expect(error.code).toBe("VALIDATION");
      expect(error.status).toBe(400);
      expect(error.message).toBe("Shared calendars cannot be view-only.");
      expect(error.fields?.visibility).toBeTruthy();
      expect(getCollection(db, ctxA, shared.id).visibility).toBe("shared");
    } finally {
      close();
    }
  });

  it("rejects a private collection without an owner", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const createError = catchAppError(() =>
        createCollection(db, ctxA, { name: "Secret", hueFamily: "slate", visibility: "private" }),
      );
      expect(createError.code).toBe("VALIDATION");
      expect(createError.status).toBe(400);
      expect(createError.message).toBe("A private collection needs an owner.");
      expect(createError.fields?.ownerId).toBeTruthy();

      const shared = createCollection(db, ctxA, { name: "Shared", hueFamily: "teal" });
      const updateError = catchAppError(() =>
        updateCollection(db, ctxA, shared.id, { visibility: "private" }),
      );
      expect(updateError.code).toBe("VALIDATION");
      expect(updateError.status).toBe(400);
      expect(updateError.message).toBe("A private collection needs an owner.");
      expect(updateError.fields?.ownerId).toBeTruthy();

      const claimed = updateCollection(db, ctxA, shared.id, {
        ownerId: "user-a",
        visibility: "private",
      });
      expect(claimed).toMatchObject({ ownerId: "user-a", visibility: "private" });
    } finally {
      close();
    }
  });

  it("rejects a sub-collection whose kind disagrees with its parent", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const root = createCollection(db, ctxA, { name: "School", hueFamily: "indigo" });
      expectAppError(
        () => createCollection(db, ctxA, { name: "Errands", parentId: root.id, kind: "list" }),
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

  it("creates the caller's private Inbox exactly once", async () => {
    const { db, close, ctxA, ctxB } = await makeSeededDb();
    try {
      const first = ensureInbox(db, ctxA);
      const second = ensureInbox(db, ctxA);
      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        name: "Inbox",
        kind: "list",
        ownerId: "user-a",
        visibility: "private",
        parentId: null,
      });
      expect(first.hueFamily).toBeTruthy();

      expect(listCollectionTree(db, ctxA).filter((node) => node.name === "Inbox")).toHaveLength(1);
      expect(listCollectionTree(db, ctxA).map((node) => node.id)).toContain(first.id);
      expect(listCollectionTree(db, ctxB).map((node) => node.id)).not.toContain(first.id);

      const theirs = ensureInbox(db, ctxB);
      expect(theirs.id).not.toBe(first.id);
      expect(theirs.ownerId).toBe("user-b");
      expect(listCollectionTree(db, ctxB).map((node) => node.id)).toEqual([theirs.id]);
      expect(listCollectionTree(db, ctxA).map((node) => node.id)).not.toContain(theirs.id);
    } finally {
      close();
    }
  });

  it("never adopts a caller-owned shared list named Inbox", async () => {
    const { db, close, ctxA } = await makeSeededDb();
    try {
      const shared = createCollection(db, ctxA, {
        name: "Inbox",
        kind: "list",
        hueFamily: "teal",
        ownerId: "user-a",
        visibility: "shared",
      });

      const inbox = ensureInbox(db, ctxA);
      expect(inbox.id).not.toBe(shared.id);
      expect(inbox).toMatchObject({
        name: "Inbox",
        kind: "list",
        ownerId: "user-a",
        visibility: "private",
        parentId: null,
      });
      expect(listCollectionTree(db, ctxA).filter((node) => node.name === "Inbox")).toHaveLength(2);

      // The shared row keeps its identity: no rename, no privacy change.
      expect(getCollection(db, ctxA, shared.id)).toMatchObject({
        name: "Inbox",
        kind: "list",
        ownerId: "user-a",
        visibility: "shared",
        parentId: null,
      });

      expect(ensureInbox(db, ctxA).id).toBe(inbox.id);
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
