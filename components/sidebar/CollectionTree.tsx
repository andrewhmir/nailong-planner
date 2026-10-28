"use client";

import { useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import {
  CHILD_SHADE_ORDER,
  PARENT_SHADE_INDEX,
  isHueFamily,
  shadeTokens,
  type HueFamily,
} from "@/lib/color/palette";
import type {
  CollectionKind,
  CollectionRow as CollectionRowType,
  CollectionVisibility,
} from "@/lib/db/schema";
import type { CollectionNode } from "@/lib/services/collections";
import {
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useUpdateCollection,
} from "@/lib/query/collections";
import { useCreateTask, useTaskCounts } from "@/lib/query/tasks";
import { canWriteCollection, foldCollectionPermission } from "@/lib/services/permissions";
import { GROUP_ORDER, groupOf, isCollectionVisible, type GroupKey } from "@/lib/ui/visibility";
import type { TreeFoldApi } from "@/lib/ui/useTreeFold";
import type { VisibilityApi } from "@/lib/ui/useVisibility";
import { cn } from "@/lib/utils";
import {
  CollectionDialog,
  type CollectionDialogResult,
  type CollectionDialogState,
} from "./CollectionDialog";
import { CollectionRow } from "./CollectionRow";

/** Canvas group headings are sentence case: the shared bucket, then each person's name. */
const GROUP_LABEL: Record<GroupKey, (viewerName: string, partnerName: string) => string> = {
  ours: () => "Shared",
  me: (viewerName) => viewerName,
  partner: (_viewerName, partnerName) => partnerName,
};

function hueOf(root: CollectionNode): HueFamily {
  return root.hueFamily && isHueFamily(root.hueFamily) ? root.hueFamily : "slate";
}

function isReadOnlyFor(
  viewerId: string,
  effective: ReturnType<typeof foldCollectionPermission>,
): boolean {
  // Private rows only ever reach their owner, so the read-only badge keeps its
  // "view only for the partner" meaning.
  return effective.visibility === "view_only" && effective.ownerId !== viewerId;
}

/** Three shades for the root's preview strip: real children first, then the ramp. */
function previewShades(root: CollectionNode): string[] {
  const hue = hueOf(root);
  const taken = new Set(root.children.map((child) => child.shadeIndex));
  const shades = root.children.map((child) => shadeTokens(hue, child.shadeIndex).main);
  for (const index of CHILD_SHADE_ORDER) {
    if (shades.length >= 3) {
      break;
    }
    if (!taken.has(index)) {
      shades.push(shadeTokens(hue, index).main);
    }
  }
  return shades.slice(0, 3);
}

interface Props {
  visibility: VisibilityApi;
  fold: TreeFoldApi;
  currentUserId: string;
  currentUserName: string;
  partnerName: string;
}

export function CollectionTree({
  visibility,
  fold,
  currentUserId,
  currentUserName,
  partnerName,
}: Props) {
  const { data, isLoading, isError } = useCollections();
  // Counts are only drawn in the tree, so the sidebar does not pay for the
  // request on the calendar; `enabled` keeps the cache entry shared once loaded.
  // The *prop* is gated too: a cached counts entry must not paint on a calendar
  // route just because it was loaded on `/tasks` a moment ago.
  const pathname = usePathname();
  const onTasksRoute = pathname.startsWith("/tasks");
  const taskCounts = useTaskCounts({ enabled: onTasksRoute });
  const createCollection = useCreateCollection();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();
  const [dialog, setDialog] = useState<CollectionDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CollectionRowType | null>(null);
  const [quickAdd, setQuickAdd] = useState<CollectionRowType | null>(null);
  // Radix cannot restore focus for this dialog: it mounts without a
  // `DialogTrigger`, so its close paths would leave focus on `<body>`. Capture
  // the opener and focus it after unmount, the same manual pattern `AppShell`
  // uses for its own dialogs.
  const quickAddOpenerRef = useRef<HTMLElement | null>(null);
  // The desktop aside and the phone sheet each mount this tree, so `aria-controls`
  // ids must be per instance or the sheet would point at the hidden aside's list.
  const instanceId = useId();

  const roots = data ?? [];

  const only = visibility.state.only;
  const onlyName = only
    ? roots
        .flatMap((root) => [root, ...root.children])
        .find((collection) => collection.id === only)?.name
    : undefined;

  /**
   * A row offers a count badge and quick add only when a create would be
   * accepted there: a writable `kind: "list"`. Calendars and read-only lists
   * (a partner-owned view-only list, a foreign private list) get neither.
   */
  function isWritableList(
    row: CollectionRowType,
    effective: ReturnType<typeof foldCollectionPermission>,
  ): boolean {
    return (
      row.kind === "list" &&
      canWriteCollection({ userId: currentUserId, householdId: "" }, effective)
    );
  }

  function openQuickAdd(collection: CollectionRowType): void {
    const active = document.activeElement;
    quickAddOpenerRef.current = active instanceof HTMLElement ? active : null;
    setQuickAdd(collection);
  }

  function closeQuickAdd(): void {
    setQuickAdd(null);
    window.setTimeout(() => {
      const opener = quickAddOpenerRef.current;
      quickAddOpenerRef.current = null;
      if (opener?.isConnected) {
        opener.focus();
      }
    }, 0);
  }

  function toggle(collection: CollectionRowType, children: CollectionRowType[] = []) {
    const parent = collection.parentId
      ? roots.find((root) => root.id === collection.parentId)
      : undefined;
    const currentlyVisible = isCollectionVisible(
      visibility.state,
      collection,
      currentUserId,
      parent,
    );
    const ids = [collection.id, ...children.map((child) => child.id)];
    visibility.setCollections(ids, !currentlyVisible);
  }

  function setVisibility(collection: CollectionRowType, next: CollectionVisibility) {
    // Visibility is server-authoritative: PATCH the value and let the
    // invalidated `["collections"]` query produce the row the server allows.
    updateCollection.mutate(
      { id: collection.id, visibility: next },
      { onError: (error) => toast.error(error.message) },
    );
  }

  function submit(values: CollectionDialogResult) {
    if (!dialog) {
      return;
    }
    const onError = (error: Error) => toast.error(error.message);

    if (dialog.mode === "edit") {
      const collection = dialog.collection;
      updateCollection.mutate(
        {
          id: collection.id,
          name: values.name,
          ...(collection.parentId === null
            ? {
                hueFamily: values.hueFamily,
                ownerId: values.ownerId ?? null,
                visibility: values.visibility,
              }
            : {}),
        },
        {
          onSuccess: (result) => {
            // A rename or owner change must not end up hidden inside a folded
            // group; open wherever the collection now lives.
            fold.expandGroup(groupOf(result.collection, currentUserId));
            setDialog(null);
          },
          onError,
        },
      );
      return;
    }

    const parentId = dialog.mode === "create-child" ? dialog.parentId : null;
    const kind: CollectionKind | undefined =
      dialog.mode === "create-root" ? (values.kind ?? dialog.kind) : undefined;
    createCollection.mutate(
      {
        name: values.name,
        parentId,
        // A child inherits its root's kind; only a root carries a chosen kind.
        kind,
        hueFamily: values.hueFamily,
        ownerId: dialog.mode === "create-root" ? (values.ownerId ?? null) : undefined,
        visibility: parentId === null ? values.visibility : undefined,
      },
      {
        onSuccess: (result) => {
          // A new collection must never be created inside a folded branch and
          // therefore invisible: open its group, and its parent for a child.
          fold.expandGroup(groupOf(result.collection, currentUserId));
          if (parentId) {
            fold.expandCollection(parentId);
          }
          setDialog(null);
        },
        onError,
      },
    );
  }

  function confirmDelete(collection: CollectionRowType) {
    // Canvas dialog, not window.confirm: the cascade is irreversible so it still
    // asks, but it asks inside the design system.
    setPendingDelete(collection);
  }

  function runDelete() {
    if (!pendingDelete) {
      return;
    }
    deleteCollection.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(`Deleted ${pendingDelete.name}`);
        setPendingDelete(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  const deleteNoun = pendingDelete?.kind === "list" ? "list" : "calendar";
  // A calendar can hold tasks too (tasks live in calendars as well as lists), so
  // its delete copy names both payloads instead of promising only events.
  const deleteItems = deleteNoun === "list" ? "tasks" : "events and tasks";

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <div className="px-3 pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="New"
            className="-ml-2 inline-flex h-7 items-center gap-2 rounded-md border border-transparent px-2 text-sm text-link transition-colors hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          >
            <PlusIcon size={16} />
            New
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setDialog({ mode: "create-root", kind: "calendar" })}>
              New calendar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog({ mode: "create-root", kind: "list" })}>
              New list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isLoading ? (
        <p className="px-3 py-2 text-sm text-ink-mute">Loading collections…</p>
      ) : null}
      {isError ? (
        <p className="px-3 py-2 text-sm text-danger-ink">Could not load collections.</p>
      ) : null}

      {onlyName ? (
        <div
          role="status"
          className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-well px-2 py-1.5 text-sm text-ink"
        >
          <span className="min-w-0 flex-1 truncate">Showing only {onlyName}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => visibility.setOnly(null)}
            className="shrink-0 text-link"
          >
            Show all
          </Button>
        </div>
      ) : null}

      {GROUP_ORDER.map((group) => {
        const groupRoots = roots.filter((root) => groupOf(root, currentUserId) === group);
        if (groupRoots.length === 0) {
          return null;
        }
        const label = GROUP_LABEL[group](currentUserName, partnerName);
        const open = fold.isGroupOpen(group);
        const listId = `collection-group-${instanceId}-${group}`;
        return (
          <section key={group} aria-label={label}>
            <h3 className="px-3 pt-3 pb-1">
              <button
                type="button"
                aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => fold.toggleGroup(group)}
                className="flex w-full items-center gap-1 rounded-sm text-left text-xs font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
              >
                <ChevronRightIcon
                  size={14}
                  className={cn(
                    "shrink-0 text-ink-mute transition-transform",
                    open && "rotate-90",
                  )}
                />
                <span className="min-w-0 truncate">{label}</span>
              </button>
            </h3>
            <ul id={listId} hidden={!open}>
              {groupRoots.map((root) => {
                const rootEffective = foldCollectionPermission(root);
                const rootReadOnly = isReadOnlyFor(currentUserId, rootEffective);
                // Badges and quick add exist only where a create would be
                // accepted: a list the viewer may write. Calendars, view-only
                // and foreign private lists must never offer a control that 403s.
                const rootQuickAdd = isWritableList(root, rootEffective);
                const openRoot = fold.isCollectionOpen(root.id);
                const childrenId = `collection-children-${instanceId}-${root.id}`;
                return (
                  <li key={root.id}>
                    <ul>
                      <CollectionRow
                        collection={root}
                        checked={isCollectionVisible(visibility.state, root, currentUserId)}
                        isChild={false}
                        ownerHue={hueOf(root)}
                        childShades={previewShades(root)}
                        readOnly={rootReadOnly}
                        visibility={rootEffective.visibility}
                        canChangeVisibility={!rootReadOnly && root.ownerId === currentUserId}
                        showViewOnlyBadge={rootReadOnly}
                        foldable={root.children.length > 0}
                        expanded={openRoot}
                        controlsId={root.children.length > 0 ? childrenId : undefined}
                        onToggleFold={() => fold.toggleCollection(root.id)}
                        onToggle={() => toggle(root, root.children)}
                        onAddChild={() =>
                          setDialog({
                            mode: "create-child",
                            parentId: root.id,
                            kind: root.kind,
                            parentVisibility: rootEffective.visibility,
                          })
                        }
                        onEdit={() => setDialog({ mode: "edit", collection: root })}
                        onDelete={() => confirmDelete(root)}
                        onSetVisibility={(next) => setVisibility(root, next)}
                        onlyId={only}
                        onShowOnly={() => visibility.setOnly(root.id)}
                        onShowAll={() => visibility.setOnly(null)}
                        taskCount={
                          onTasksRoute && rootQuickAdd
                            ? taskCounts.data?.byCollection[root.id]
                            : undefined
                        }
                        onQuickAdd={rootQuickAdd ? () => openQuickAdd(root) : undefined}
                      />
                    </ul>
                    {root.children.length > 0 ? (
                      <ul id={childrenId} hidden={!openRoot}>
                        {root.children.map((child) => {
                          const childEffective = foldCollectionPermission(child, root);
                          const childReadOnly = isReadOnlyFor(currentUserId, childEffective);
                          const childQuickAdd = isWritableList(child, childEffective);
                          return (
                            <CollectionRow
                              key={child.id}
                              collection={child}
                              checked={isCollectionVisible(
                                visibility.state,
                                child,
                                currentUserId,
                                root,
                              )}
                              isChild
                              ownerHue={hueOf(root)}
                              childShades={[]}
                              readOnly={childReadOnly}
                              visibility={childEffective.visibility}
                              canChangeVisibility={false}
                              showViewOnlyBadge={childReadOnly}
                              onToggle={() => toggle(child)}
                              onAddChild={() => undefined}
                              onEdit={() =>
                                setDialog({
                                  mode: "edit",
                                  collection: child,
                                  inheritedVisibility: rootEffective.visibility,
                                })
                              }
                              onDelete={() => confirmDelete(child)}
                              onSetVisibility={() => undefined}
                              onlyId={only}
                              onShowOnly={() => visibility.setOnly(child.id)}
                              onShowAll={() => visibility.setOnly(null)}
                              taskCount={
                                onTasksRoute && childQuickAdd
                                  ? taskCounts.data?.byCollection[child.id]
                                  : undefined
                              }
                              onQuickAdd={childQuickAdd ? () => openQuickAdd(child) : undefined}
                            />
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {pendingDelete ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setPendingDelete(null);
            }
          }}
        >
          <DialogContent
            title={`Delete ${deleteNoun}?`}
            description={
              pendingDelete.parentId
                ? `"${pendingDelete.name}" and its ${deleteItems} will be removed. This cannot be undone.`
                : `"${pendingDelete.name}", its sub-${deleteNoun}s and their ${deleteItems} will be removed. This cannot be undone.`
            }
          >
            <div className="flex justify-end gap-3">
              <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button
                variant="primary"
                aria-label={`Delete ${deleteNoun}`}
                className="border border-danger-ink bg-danger-soft text-danger-ink hover:bg-danger-soft/80"
                onClick={runDelete}
                disabled={deleteCollection.isPending}
              >
                Delete {deleteNoun}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {quickAdd ? <QuickAddDialog collection={quickAdd} onClose={closeQuickAdd} /> : null}

      <CollectionDialog
        state={dialog}
        pending={createCollection.isPending || updateCollection.isPending}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        onClose={() => setDialog(null)}
        onSubmit={submit}
      />
    </div>
  );
}

const QUICK_ADD_CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink transition-colors hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 [@media(pointer:coarse)]:h-11";

/**
 * One-field create for a list the viewer owns or that is shared. It is mounted
 * only while open, so every opening starts empty. `CollectionTree` restores
 * focus to the opener after unmount: Radix cannot do it because this dialog is
 * mounted without a `DialogTrigger`.
 * The title is cleared only by unmount: a failed create keeps the dialog and
 * the typed text, and the mutation's `["tasks"]` invalidation refreshes the
 * badge once it succeeds.
 */
function QuickAddDialog({
  collection,
  onClose,
}: {
  collection: CollectionRowType;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const createTask = useCreateTask();
  const inputId = useId();
  const value = title.trim();

  function addTask(): void {
    if (value.length === 0 || createTask.isPending) {
      return;
    }
    createTask.mutate(
      { title: value, collectionId: collection.id },
      {
        onSuccess: () => {
          toast.success("Task added");
          onClose();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={`Add a task to ${collection.name}`}
        description="It appears at the bottom of the list."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            addTask();
          }}
        >
          <div className="space-y-1">
            <label htmlFor={inputId} className="block text-base text-ink">
              Task title
            </label>
            <input
              id={inputId}
              type="text"
              value={title}
              autoFocus
              maxLength={200}
              autoComplete="off"
              disabled={createTask.isPending}
              data-testid="sidebar-quick-add-input"
              onChange={(event) => setTitle(event.target.value)}
              className={QUICK_ADD_CONTROL}
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              type="submit"
              disabled={createTask.isPending || value.length === 0}
            >
              {createTask.isPending ? "Adding…" : "Add task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
