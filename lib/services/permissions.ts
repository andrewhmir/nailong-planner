import type { CollectionRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export interface ViewerContext {
  userId: string;
  householdId: string;
}

/**
 * The permission columns that actually apply to a collection after its root's
 * flags are folded in. `householdId` travels with them so a predicate call is
 * self-contained and cannot accidentally treat a foreign row as visible.
 */
export type EffectiveCollection = Pick<CollectionRow, "ownerId" | "visibility" | "householdId">;

/** The root-owned flags a client fold needs; no storage fields, so it is client-safe. */
export interface CollectionPermissionFlags {
  ownerId: string | null;
  visibility: CollectionRow["visibility"];
}

/**
 * Folds a root's owner and visibility into one of its children, the client-side
 * twin of `getCollectionAccess(...).effective` in `lib/services/collections.ts`.
 * A child inherits its root's owner; a non-`shared` root protects the whole
 * branch, so its visibility overrides whatever the child row stores. A
 * `shared` root defers to the child's own visibility, which is how the sidebar,
 * the movable-list pickers and `CalendarShell.readOnlyCollectionIds` all judge a
 * nested collection. Pure types only: importing this from a client component
 * never pulls in the database.
 */
export function foldCollectionPermission(
  collection: Pick<CollectionRow, "ownerId" | "visibility">,
  root?: Pick<CollectionRow, "ownerId" | "visibility"> | null,
): CollectionPermissionFlags {
  return {
    ownerId: root?.ownerId ?? collection.ownerId,
    visibility: root && root.visibility !== "shared" ? root.visibility : collection.visibility,
  };
}

/**
 * The one write-permission rule for collections and the events inside them.
 *
 * A `view_only` (or `private`) collection may only be written by its owner;
 * `shared` ("Ours") collections are always writable. An ownerless non-shared
 * collection is writable by nobody — validation prevents that state, and if it
 * somehow exists this predicate fails closed.
 */
export function canWriteCollection(
  viewer: ViewerContext,
  collection: Pick<CollectionRow, "ownerId" | "visibility">,
): boolean {
  if (collection.visibility === "shared") {
    return true;
  }
  return collection.ownerId !== null && collection.ownerId === viewer.userId;
}

/**
 * The one visibility predicate for reads. A `private` collection is readable
 * only by its effective owner; `shared` and `view_only` are readable by both
 * household members. A foreign household is never visible. Callers must pass
 * the effective flags (root-folded) — a child row always carries
 * `visibility: "shared"`, so judging the raw row would leak a private root.
 */
export function canReadCollection(
  viewer: ViewerContext,
  collection: EffectiveCollection,
): boolean {
  if (collection.householdId !== viewer.householdId) {
    return false;
  }
  return collection.visibility !== "private" || collection.ownerId === viewer.userId;
}

/**
 * The one write guard, shared by collection and event writes.
 *
 * - foreign household -> `NOT_FOUND` 404 (a row outside the tenant does not exist);
 * - `private` not owned -> `NOT_FOUND` 404, so a probe cannot distinguish it from
 *   a missing id;
 * - `view_only` not owned (or ownerless) -> `FORBIDDEN` 403;
 * - `shared` -> writable by either member.
 */
export function assertWritable(collection: EffectiveCollection, ctx: ViewerContext): void {
  if (!canReadCollection(ctx, collection)) {
    throw new AppError("NOT_FOUND", "Calendar not found.", 404);
  }
  if (!canWriteCollection(ctx, collection)) {
    throw new AppError("FORBIDDEN", "This collection is view-only.", 403);
  }
}
