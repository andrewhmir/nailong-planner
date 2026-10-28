import type { CollectionNode } from "@/lib/services/collections";
import { isCollectionVisible, type VisibilityState } from "./visibility";

/**
 * The ids currently drawn in the grid: a root contributes only when its person
 * pill and its own checkbox agree, and a child additionally needs its parent's
 * checkbox. One implementation so the sidebar mini-month and the grid cannot
 * disagree about what "visible" means.
 */
export function visibleCollectionIds(
  roots: CollectionNode[],
  state: VisibilityState,
  userId: string,
): Set<string> {
  // "Display only this calendar" is exact, and it may name a sub-collection
  // whose parent is filtered out. Returning it directly avoids the branch being
  // pruned below before the isolated child is ever reached.
  if (state.only !== null) {
    return new Set([state.only]);
  }

  const ids = new Set<string>();
  for (const root of roots) {
    if (!isCollectionVisible(state, root, userId)) {
      continue;
    }
    ids.add(root.id);
    for (const child of root.children) {
      if (isCollectionVisible(state, child, userId, root)) {
        ids.add(child.id);
      }
    }
  }
  return ids;
}

/**
 * The exact complement of `visibleCollectionIds`: every root and child the
 * person pills, a per-collection checkbox or "display only this calendar" are
 * currently hiding, sorted for a stable query key.
 *
 * The tasks workspace sends these ids to `GET /api/tasks`, which omits their
 * rows *and* their counts — otherwise the tab badges would disagree with the
 * painted list. It is a display filter built from the ids the server already
 * returned, never a permission, so an id that no longer exists is harmless.
 */
export function hiddenCollectionIds(
  roots: CollectionNode[],
  state: VisibilityState,
  userId: string,
): string[] {
  const visible = visibleCollectionIds(roots, state, userId);
  const hidden: string[] = [];
  for (const root of roots) {
    for (const collection of [root, ...root.children]) {
      if (!visible.has(collection.id)) {
        hidden.push(collection.id);
      }
    }
  }
  return hidden.sort();
}
