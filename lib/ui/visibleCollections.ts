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
