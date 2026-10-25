import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { collection, type CollectionRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  CHILD_SHADE_ORDER,
  HUE_FAMILIES,
  MAX_CHILDREN,
  PARENT_SHADE_INDEX,
  isHueFamily,
  shadeTokens,
  type HueFamily,
  type ShadeTokens,
} from "@/lib/color/palette";
import type { CreateCollectionInput, UpdateCollectionInput } from "@/lib/validation/collections";
import {
  assertWritable,
  canReadCollection,
  type EffectiveCollection,
  type ViewerContext,
} from "./permissions";

export interface CollectionNode extends CollectionRow {
  children: CollectionRow[];
}

export interface CollectionAccess {
  collection: CollectionRow;
  root: CollectionRow | null;
  /** Permission columns with the root's flags folded in, plus the row's household. */
  effective: EffectiveCollection;
}

/** The name of the per-user list that captures undated tasks. */
export const INBOX_NAME = "Inbox";

const VISIBILITY_RANK: Record<CollectionRow["visibility"], number> = {
  shared: 0,
  view_only: 1,
  private: 2,
};

/** Folds a root's visibility into a child's: the most restrictive value wins. */
function mostRestrictiveVisibility(
  root: CollectionRow["visibility"],
  row: CollectionRow["visibility"],
): CollectionRow["visibility"] {
  return VISIBILITY_RANK[root] >= VISIBILITY_RANK[row] ? root : row;
}

/**
 * The effective permission columns of one row. A sub-collection inherits its
 * root's owner and the most restrictive of the two visibilities, so a stale
 * child row can never outrank the root it belongs to.
 */
function foldEffective(row: CollectionRow, root: CollectionRow | null): EffectiveCollection {
  return {
    householdId: row.householdId,
    ownerId: root?.ownerId ?? row.ownerId,
    visibility: root ? mostRestrictiveVisibility(root.visibility, row.visibility) : row.visibility,
  };
}

function nextSortOrder(db: Database, householdId: string, parentId: string | null): number {
  const rows =
    parentId === null
      ? db
          .select()
          .from(collection)
          .where(and(eq(collection.householdId, householdId), isNull(collection.parentId)))
          .all()
      : db.select().from(collection).where(eq(collection.parentId, parentId)).all();
  const max = rows.reduce((highest, row) => Math.max(highest, row.sortOrder), -1);
  return max + 1;
}

function loadCollection(db: Database, ctx: ViewerContext, id: string): CollectionRow {
  const row = db
    .select()
    .from(collection)
    .where(and(eq(collection.id, id), eq(collection.householdId, ctx.householdId)))
    .get();
  if (!row) {
    throw new AppError("NOT_FOUND", "Calendar not found.", 404);
  }
  return row;
}

function loadAccess(db: Database, ctx: ViewerContext, id: string): CollectionAccess {
  const row = loadCollection(db, ctx, id);
  const root =
    row.parentId === null
      ? null
      : (db
          .select()
          .from(collection)
          .where(and(eq(collection.id, row.parentId), eq(collection.householdId, ctx.householdId)))
          .get() ?? null);

  return { collection: row, root, effective: foldEffective(row, root) };
}

/**
 * Reads are guarded by effective visibility: a private collection the viewer
 * does not own answers exactly like a missing one, so its existence never leaks.
 */
export function getCollection(db: Database, ctx: ViewerContext, id: string): CollectionRow {
  const access = loadAccess(db, ctx, id);
  if (!canReadCollection(ctx, access.effective)) {
    throw new AppError("NOT_FOUND", "Calendar not found.", 404);
  }
  return access.collection;
}

/** The read-side guard: `NOT_FOUND` when the collection is missing or invisible. */
export function assertCollectionVisible(
  db: Database,
  ctx: ViewerContext,
  id: string,
): CollectionRow {
  return getCollection(db, ctx, id);
}

/**
 * Loads a collection together with the permission flags that actually apply to
 * it. A sub-collection inherits its root's owner and visibility, so marking a
 * parent view-only or private also protects every sub-collection beneath it.
 */
export function getCollectionAccess(
  db: Database,
  ctx: ViewerContext,
  id: string,
): CollectionAccess {
  const access = loadAccess(db, ctx, id);
  if (!canReadCollection(ctx, access.effective)) {
    throw new AppError("NOT_FOUND", "Calendar not found.", 404);
  }
  return access;
}

/**
 * The one visibility resolver. Every read path that lists collections derives
 * its rows here; a private collection is kept only for its effective owner, and
 * a private root therefore takes its subtree with it.
 */
export function resolveVisibleCollections(
  db: Database,
  ctx: ViewerContext,
): CollectionRow[] {
  const rows = db
    .select()
    .from(collection)
    .where(eq(collection.householdId, ctx.householdId))
    .orderBy(asc(collection.sortOrder), asc(collection.createdAt))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));

  return rows.filter((row) =>
    canReadCollection(
      ctx,
      foldEffective(row, row.parentId === null ? null : (byId.get(row.parentId) ?? null)),
    ),
  );
}

export function assertCollectionWritable(ctx: ViewerContext, access: CollectionAccess): void {
  assertWritable(access.effective, ctx);
}

export function listCollectionTree(db: Database, ctx: ViewerContext): CollectionNode[] {
  const rows = resolveVisibleCollections(db, ctx);

  const roots: CollectionNode[] = rows
    .filter((row) => row.parentId === null)
    .map((row) => ({ ...row, children: [] }));
  const byId = new Map(roots.map((root) => [root.id, root]));

  for (const row of rows) {
    if (row.parentId !== null) {
      // A child is only attached under a visible root, so a hidden root's
      // subtree disappears with it even if a child row looked visible alone.
      byId.get(row.parentId)?.children.push(row);
    }
  }

  for (const root of roots) {
    root.children.sort((a, b) => a.shadeIndex - b.shadeIndex);
  }

  return roots;
}

export function createCollection(
  db: Database,
  ctx: ViewerContext,
  input: CreateCollectionInput,
): CollectionRow {
  const name = input.name.trim();
  const now = Date.now();

  if (input.parentId) {
    const parentAccess = getCollectionAccess(db, ctx, input.parentId);
    if (parentAccess.collection.parentId !== null) {
      throw new AppError(
        "VALIDATION",
        "Sub-calendars cannot be nested deeper than two levels.",
        400,
        { parentId: "Pick a top-level calendar as the parent." },
      );
    }
    assertWritable(parentAccess.effective, ctx);
    const parent = parentAccess.collection;
    if (input.kind !== undefined && input.kind !== parent.kind) {
      throw new AppError(
        "VALIDATION",
        "A sub-collection must be the same kind as its parent.",
        400,
        { kind: "Pick a parent of the same kind." },
      );
    }

    const existing = db.select().from(collection).where(eq(collection.parentId, parent.id)).all();
    if (existing.length >= MAX_CHILDREN) {
      throw new AppError(
        "CONFLICT",
        `This calendar already has the maximum of ${MAX_CHILDREN} sub-calendars.`,
        409,
      );
    }
    const usedShades = new Set(existing.map((row) => row.shadeIndex));
    const shadeIndex = CHILD_SHADE_ORDER.find((candidate) => !usedShades.has(candidate));
    if (shadeIndex === undefined) {
      throw new AppError(
        "CONFLICT",
        `This calendar already has the maximum of ${MAX_CHILDREN} sub-calendars.`,
        409,
      );
    }

    const row: CollectionRow = {
      id: crypto.randomUUID(),
      householdId: ctx.householdId,
      parentId: parent.id,
      name,
      hueFamily: null,
      shadeIndex,
      ownerId: parent.ownerId,
      kind: parent.kind,
      visibility: "shared",
      sortOrder: nextSortOrder(db, ctx.householdId, parent.id),
      createdAt: now,
      updatedAt: now,
    };
    db.insert(collection).values(row).run();
    return row;
  }

  if (!input.hueFamily) {
    throw new AppError("VALIDATION", "Top-level calendars need a color family.", 400, {
      hueFamily: "Choose a color family.",
    });
  }

  const ownerId = input.ownerId ?? null;
  if (ownerId !== null && ownerId !== ctx.userId) {
    throw new AppError(
      "FORBIDDEN",
      "You can only create calendars for yourself or shared ones.",
      403,
    );
  }

  const visibility = input.visibility ?? "shared";
  if (visibility === "private" && ownerId === null) {
    throw new AppError("VALIDATION", "A private collection needs an owner.", 400, {
      ownerId: "Assign the collection to yourself first.",
    });
  }
  if (visibility !== "shared" && ownerId === null) {
    throw new AppError("VALIDATION", "Shared calendars cannot be view-only.", 400, {
      visibility: "Assign the calendar to yourself first.",
    });
  }

  const row: CollectionRow = {
    id: crypto.randomUUID(),
    householdId: ctx.householdId,
    parentId: null,
    name,
    hueFamily: input.hueFamily,
    shadeIndex: PARENT_SHADE_INDEX,
    ownerId,
    kind: input.kind ?? "calendar",
    visibility,
    sortOrder: nextSortOrder(db, ctx.householdId, null),
    createdAt: now,
    updatedAt: now,
  };
  db.insert(collection).values(row).run();
  return row;
}

export function updateCollection(
  db: Database,
  ctx: ViewerContext,
  id: string,
  input: UpdateCollectionInput,
): CollectionRow {
  const access = getCollectionAccess(db, ctx, id);
  assertWritable(access.effective, ctx);
  const existing = access.collection;

  const patch: Partial<CollectionRow> = {};

  if (input.name !== undefined) {
    patch.name = input.name.trim();
  }
  if (input.sortOrder !== undefined) {
    patch.sortOrder = input.sortOrder;
  }
  if (input.hueFamily !== undefined) {
    if (existing.parentId !== null) {
      throw new AppError(
        "VALIDATION",
        "Only top-level calendars have a color family; sub-calendars inherit theirs.",
        400,
        { hueFamily: "Change the parent calendar's color instead." },
      );
    }
    patch.hueFamily = input.hueFamily;
  }
  if (input.ownerId !== undefined) {
    if (existing.parentId !== null) {
      throw new AppError(
        "VALIDATION",
        "A sub-calendar inherits its parent's owner; change the top-level calendar instead.",
        400,
        { ownerId: "Change the parent calendar's owner instead." },
      );
    }
    if (existing.ownerId !== null && existing.ownerId !== ctx.userId) {
      throw new AppError("FORBIDDEN", "Only the owner can change who owns this calendar.", 403);
    }
    if (input.ownerId !== null && input.ownerId !== ctx.userId) {
      throw new AppError(
        "FORBIDDEN",
        "You can only assign a calendar to yourself or leave it shared.",
        403,
      );
    }
    patch.ownerId = input.ownerId ?? null;
    if (patch.ownerId === null) {
      patch.visibility = "shared";
    }
  }
  if (input.visibility !== undefined) {
    if (existing.parentId !== null) {
      throw new AppError(
        "VALIDATION",
        "Mark the top-level calendar view-only or private; sub-calendars inherit it.",
        400,
        { visibility: "Change the parent calendar instead." },
      );
    }
    const ownerAfter = patch.ownerId === undefined ? existing.ownerId : patch.ownerId;
    if (input.visibility === "private" && ownerAfter === null) {
      throw new AppError("VALIDATION", "A private collection needs an owner.", 400, {
        ownerId: "Assign the collection to yourself first.",
      });
    }
    if (ownerAfter !== ctx.userId) {
      throw new AppError("FORBIDDEN", "Only the owner can change view-only access.", 403);
    }
    patch.visibility = input.visibility;
  }

  if (Object.keys(patch).length === 0) {
    return existing;
  }

  const now = Date.now();
  db.transaction((tx) => {
    const txn = tx as unknown as Database;
    txn
      .update(collection)
      .set({ ...patch, updatedAt: now })
      .where(eq(collection.id, id))
      .run();
    // A sub-collection inherits its root's owner. Carrying an owner move down
    // keeps the sidebar group, grid visibility and getCollectionAccess in
    // agreement, so a re-owned parent can never leave its children behind in
    // "Ours".
    if (existing.parentId === null && patch.ownerId !== undefined) {
      txn
        .update(collection)
        .set({ ownerId: patch.ownerId, updatedAt: now })
        .where(eq(collection.parentId, id))
        .run();
    }
  });

  return getCollection(db, ctx, id);
}

export function deleteCollection(db: Database, ctx: ViewerContext, id: string): void {
  const access = getCollectionAccess(db, ctx, id);
  assertWritable(access.effective, ctx);
  db.delete(collection).where(eq(collection.id, id)).run();
}

/**
 * The palette's next unused root hue family, so a lazily created Inbox never
 * collides with an existing top-level colour.
 */
function nextRootHueFamily(db: Database, householdId: string): HueFamily {
  const roots = db
    .select()
    .from(collection)
    .where(and(eq(collection.householdId, householdId), isNull(collection.parentId)))
    .all();
  const used = new Set(
    roots
      .map((row) => row.hueFamily)
      .filter((family): family is HueFamily => family !== null && isHueFamily(family)),
  );
  return HUE_FAMILIES.find((family) => !used.has(family)) ?? "slate";
}

/**
 * Returns the caller's root Inbox list, creating one the first time it is
 * needed. `name` is the identity: a renamed Inbox is re-created on the next
 * call, until a stored inbox marker exists.
 *
 * better-sqlite3 is synchronous and the app runs in one process, so the read and
 * the insert below cannot interleave with another request's `ensureInbox`; there
 * is no creation race to guard.
 */
export function ensureInbox(db: Database, ctx: ViewerContext): CollectionRow {
  const existing = db
    .select()
    .from(collection)
    .where(
      and(
        eq(collection.householdId, ctx.householdId),
        eq(collection.kind, "list"),
        eq(collection.name, INBOX_NAME),
        eq(collection.ownerId, ctx.userId),
        isNull(collection.parentId),
      ),
    )
    .get();
  if (existing) {
    return existing;
  }

  return createCollection(db, ctx, {
    name: INBOX_NAME,
    kind: "list",
    hueFamily: nextRootHueFamily(db, ctx.householdId),
    ownerId: ctx.userId,
    visibility: "private",
    parentId: null,
  });
}

/** Resolves the rendered shade for a collection, following its root's hue family. */
export function resolveShade(db: Database, target: CollectionRow): ShadeTokens {
  const root =
    target.parentId === null
      ? target
      : db.select().from(collection).where(eq(collection.id, target.parentId)).get();

  const family = root?.hueFamily && isHueFamily(root.hueFamily) ? root.hueFamily : "slate";
  const shadeIndex = target.parentId === null ? PARENT_SHADE_INDEX : target.shadeIndex;
  return shadeTokens(family, shadeIndex);
}
