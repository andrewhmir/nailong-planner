"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import {
  CHILD_SHADE_ORDER,
  PARENT_SHADE_INDEX,
  isHueFamily,
  shadeTokens,
  type HueFamily,
} from "@/lib/color/palette";
import type { CalendarRow as CalendarRowType } from "@/lib/db/schema";
import type { CalendarNode } from "@/lib/services/calendars";
import {
  useCalendars,
  useCreateCalendar,
  useDeleteCalendar,
  useUpdateCalendar,
} from "@/lib/query/calendars";
import { GROUP_ORDER, groupOf, isCalendarVisible, type GroupKey } from "@/lib/ui/visibility";
import type { TreeFoldApi } from "@/lib/ui/useTreeFold";
import type { VisibilityApi } from "@/lib/ui/useVisibility";
import { cn } from "@/lib/utils";
import { CalendarDialog, type CalendarDialogResult, type CalendarDialogState } from "./CalendarDialog";
import { CalendarRow } from "./CalendarRow";

/** Canvas group headings are sentence case: the shared bucket, then each person's name. */
const GROUP_LABEL: Record<GroupKey, (viewerName: string, partnerName: string) => string> = {
  ours: () => "Shared",
  me: (viewerName) => viewerName,
  partner: (_viewerName, partnerName) => partnerName,
};

function hueOf(root: CalendarNode): HueFamily {
  return root.hueFamily && isHueFamily(root.hueFamily) ? root.hueFamily : "slate";
}

interface Effective {
  ownerId: string | null;
  viewOnly: boolean;
}

function effectivePermission(
  calendar: CalendarRowType,
  root?: { ownerId: string | null; isViewOnlyForPartner: number } | null,
): Effective {
  return {
    ownerId: root?.ownerId ?? calendar.ownerId,
    viewOnly: Math.max(root?.isViewOnlyForPartner ?? 0, calendar.isViewOnlyForPartner) === 1,
  };
}

function isReadOnlyFor(viewerId: string, effective: Effective): boolean {
  return effective.viewOnly && effective.ownerId !== viewerId;
}

/** Three shades for the root's preview strip: real children first, then the ramp. */
function previewShades(root: CalendarNode): string[] {
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

export function CalendarTree({
  visibility,
  fold,
  currentUserId,
  currentUserName,
  partnerName,
}: Props) {
  const { data, isLoading, isError } = useCalendars();
  const createCalendar = useCreateCalendar();
  const updateCalendar = useUpdateCalendar();
  const deleteCalendar = useDeleteCalendar();
  const [dialog, setDialog] = useState<CalendarDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarRowType | null>(null);
  // The desktop aside and the phone sheet each mount this tree, so `aria-controls`
  // ids must be per instance or the sheet would point at the hidden aside's list.
  const instanceId = useId();

  const roots = data ?? [];

  const only = visibility.state.only;
  const onlyName = only
    ? roots
        .flatMap((root) => [root, ...root.children])
        .find((calendar) => calendar.id === only)?.name
    : undefined;

  function toggle(calendar: CalendarRowType, children: CalendarRowType[] = []) {
    const parent = calendar.parentId ? roots.find((root) => root.id === calendar.parentId) : undefined;
    const currentlyVisible = isCalendarVisible(visibility.state, calendar, currentUserId, parent);
    const ids = [calendar.id, ...children.map((child) => child.id)];
    visibility.setCalendars(ids, !currentlyVisible);
  }

  function submit(values: CalendarDialogResult) {
    if (!dialog) {
      return;
    }
    const onError = (error: Error) => toast.error(error.message);

    if (dialog.mode === "edit") {
      const calendar = dialog.calendar;
      updateCalendar.mutate(
        {
          id: calendar.id,
          name: values.name,
          ...(calendar.parentId === null
            ? {
                hueFamily: values.hueFamily,
                ownerId: values.ownerId ?? null,
                isViewOnlyForPartner: values.isViewOnlyForPartner ?? false,
              }
            : {}),
        },
        {
          onSuccess: (result) => {
            // A rename or owner change must not end up hidden inside a folded
            // group; open wherever the calendar now lives.
            fold.expandGroup(groupOf(result.calendar, currentUserId));
            setDialog(null);
          },
          onError,
        },
      );
      return;
    }

    const parentId = dialog.mode === "create-child" ? dialog.parentId : null;
    createCalendar.mutate(
      {
        name: values.name,
        parentId,
        hueFamily: values.hueFamily,
        ownerId: dialog.mode === "create-root" ? (values.ownerId ?? null) : undefined,
        isViewOnlyForPartner: values.isViewOnlyForPartner,
      },
      {
        onSuccess: (result) => {
          // A new calendar must never be created inside a folded branch and
          // therefore invisible: open its group, and its parent for a child.
          fold.expandGroup(groupOf(result.calendar, currentUserId));
          if (parentId) {
            fold.expandCalendar(parentId);
          }
          setDialog(null);
        },
        onError,
      },
    );
  }

  function confirmDelete(calendar: CalendarRowType) {
    // Canvas dialog, not window.confirm: the cascade is irreversible so it still
    // asks, but it asks inside the design system.
    setPendingDelete(calendar);
  }

  function runDelete() {
    if (!pendingDelete) {
      return;
    }
    deleteCalendar.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(`Deleted ${pendingDelete.name}`);
        setPendingDelete(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <div className="flex w-full min-w-0 flex-col pb-6">
      <div className="px-3 pt-3">
        <Button
          size="sm"
          variant="ghost"
          aria-label="New calendar"
          onClick={() => setDialog({ mode: "create-root" })}
          className="-ml-2 text-link"
        >
          <PlusIcon size={16} />
          New calendar
        </Button>
      </div>

      {isLoading ? <p className="px-3 py-2 text-sm text-ink-mute">Loading calendars…</p> : null}
      {isError ? (
        <p className="px-3 py-2 text-sm text-danger-ink">Could not load calendars.</p>
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
        const listId = `calendar-group-${instanceId}-${group}`;
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
                const rootEffective = effectivePermission(root);
                const openRoot = fold.isCalendarOpen(root.id);
                const childrenId = `calendar-children-${instanceId}-${root.id}`;
                return (
                  <li key={root.id}>
                    <ul>
                      <CalendarRow
                        calendar={root}
                        checked={isCalendarVisible(visibility.state, root, currentUserId)}
                        isChild={false}
                        ownerHue={hueOf(root)}
                        childShades={previewShades(root)}
                        readOnly={isReadOnlyFor(currentUserId, rootEffective)}
                        showViewOnlyBadge={isReadOnlyFor(currentUserId, rootEffective)}
                        foldable={root.children.length > 0}
                        expanded={openRoot}
                        controlsId={root.children.length > 0 ? childrenId : undefined}
                        onToggleFold={() => fold.toggleCalendar(root.id)}
                        onToggle={() => toggle(root, root.children)}
                        onAddChild={() => setDialog({ mode: "create-child", parentId: root.id })}
                        onEdit={() => setDialog({ mode: "edit", calendar: root })}
                        onDelete={() => confirmDelete(root)}
                        onlyId={only}
                        onShowOnly={() => visibility.setOnly(root.id)}
                        onShowAll={() => visibility.setOnly(null)}
                      />
                    </ul>
                    {root.children.length > 0 ? (
                      <ul id={childrenId} hidden={!openRoot}>
                        {root.children.map((child) => {
                          const childEffective = effectivePermission(child, root);
                          return (
                            <CalendarRow
                              key={child.id}
                              calendar={child}
                              checked={isCalendarVisible(visibility.state, child, currentUserId, root)}
                              isChild
                              ownerHue={hueOf(root)}
                              childShades={[]}
                              readOnly={isReadOnlyFor(currentUserId, childEffective)}
                              showViewOnlyBadge={isReadOnlyFor(currentUserId, childEffective)}
                              onToggle={() => toggle(child)}
                              onAddChild={() => undefined}
                              onEdit={() => setDialog({ mode: "edit", calendar: child })}
                              onDelete={() => confirmDelete(child)}
                              onlyId={only}
                              onShowOnly={() => visibility.setOnly(child.id)}
                              onShowAll={() => visibility.setOnly(null)}
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
            title="Delete calendar?"
            description={
              pendingDelete.parentId
                ? `"${pendingDelete.name}" and its events will be removed. This cannot be undone.`
                : `"${pendingDelete.name}", its sub-calendars and their events will be removed. This cannot be undone.`
            }
          >
            <div className="flex justify-end gap-3">
              <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button
                variant="primary"
                aria-label="Delete calendar"
                className="border border-danger-ink bg-danger-soft text-danger-ink hover:bg-danger-soft/80"
                onClick={runDelete}
                disabled={deleteCalendar.isPending}
              >
                Delete calendar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <CalendarDialog
        state={dialog}
        pending={createCalendar.isPending || updateCalendar.isPending}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        onClose={() => setDialog(null)}
        onSubmit={submit}
      />
    </div>
  );
}
