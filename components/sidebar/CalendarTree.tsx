"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
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
import type { VisibilityApi } from "@/lib/ui/useVisibility";
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
  currentUserId: string;
  currentUserName: string;
  partnerName: string;
}

export function CalendarTree({ visibility, currentUserId, currentUserName, partnerName }: Props) {
  const { data, isLoading, isError } = useCalendars();
  const createCalendar = useCreateCalendar();
  const updateCalendar = useUpdateCalendar();
  const deleteCalendar = useDeleteCalendar();
  const [dialog, setDialog] = useState<CalendarDialogState | null>(null);

  const roots = data ?? [];

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
        { onSuccess: () => setDialog(null), onError },
      );
      return;
    }

    createCalendar.mutate(
      {
        name: values.name,
        parentId: dialog.mode === "create-child" ? dialog.parentId : null,
        hueFamily: values.hueFamily,
        ownerId: dialog.mode === "create-root" ? (values.ownerId ?? null) : undefined,
        isViewOnlyForPartner: values.isViewOnlyForPartner,
      },
      { onSuccess: () => setDialog(null), onError },
    );
  }

  function confirmDelete(calendar: CalendarRowType) {
    const label = calendar.parentId
      ? "sub-calendar and its events"
      : "calendar, its sub-calendars and their events";
    const confirmed = window.confirm(`Delete "${calendar.name}"? This removes the ${label}.`);
    if (!confirmed) {
      return;
    }
    deleteCalendar.mutate(calendar.id, {
      onSuccess: () => toast.success(`Deleted ${calendar.name}`),
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

      {GROUP_ORDER.map((group) => {
        const groupRoots = roots.filter((root) => groupOf(root, currentUserId) === group);
        if (groupRoots.length === 0) {
          return null;
        }
        const label = GROUP_LABEL[group](currentUserName, partnerName);
        return (
          <section key={group} aria-label={label}>
            <h3 className="px-3 pt-3 pb-1 text-xs font-bold text-ink">{label}</h3>
            <ul>
              {groupRoots.map((root) => {
                const rootEffective = effectivePermission(root);
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
                        onToggle={() => toggle(root, root.children)}
                        onAddChild={() => setDialog({ mode: "create-child", parentId: root.id })}
                        onEdit={() => setDialog({ mode: "edit", calendar: root })}
                        onDelete={() => confirmDelete(root)}
                      />
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
                          />
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

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
