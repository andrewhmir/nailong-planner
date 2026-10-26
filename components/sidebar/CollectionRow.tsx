"use client";

import { useId } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronRightIcon,
  ListIcon,
  LockIcon,
  MoreVerticalIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { PARENT_SHADE_INDEX, shadeTokens, type HueFamily } from "@/lib/color/palette";
import type {
  CollectionRow as CollectionRowType,
  CollectionVisibility,
} from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const VISIBILITY_LABELS: Record<CollectionVisibility, string> = {
  shared: "Shared",
  view_only: "View only",
  private: "Private",
};

interface Props {
  collection: CollectionRowType;
  checked: boolean;
  isChild: boolean;
  ownerHue: HueFamily;
  childShades: string[];
  readOnly: boolean;
  /** The visibility that actually applies: a child inherits its root's value. */
  visibility: CollectionVisibility;
  /** Only an editable collection the viewer owns may change its visibility. */
  canChangeVisibility: boolean;
  /** Whether the read-only "View only" lock applies (partner-owned collections). */
  showViewOnlyBadge: boolean;
  /** The calendar "display only this calendar" is showing, if any. */
  onlyId: string | null;
  /** Active-task total; a muted pill renders only when this is positive. */
  taskCount?: number;
  /**
   * Present only on a list row the viewer may write to: opens the quick-add
   * dialog. Never passed for calendars, view-only or foreign private lists.
   */
  onQuickAdd?: () => void;
  /** Root rows with sub-collections get a disclosure button. */
  foldable?: boolean;
  /** Whether this root's sub-collections are currently shown. */
  expanded?: boolean;
  /** id of the sub-collection list this row's disclosure button controls. */
  controlsId?: string;
  onToggleFold?: () => void;
  onToggle: () => void;
  onAddChild: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetVisibility: (visibility: CollectionVisibility) => void;
  onShowOnly: () => void;
  onShowAll: () => void;
}

export function CollectionRow({
  collection,
  checked,
  isChild,
  ownerHue,
  childShades,
  readOnly,
  visibility,
  canChangeVisibility,
  showViewOnlyBadge,
  onlyId,
  taskCount,
  onQuickAdd,
  foldable = false,
  expanded = true,
  controlsId,
  onToggleFold,
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
  onSetVisibility,
  onShowOnly,
  onShowAll,
}: Props) {
  const tokens = shadeTokens(ownerHue, isChild ? collection.shadeIndex : PARENT_SHADE_INDEX);
  const isOnly = onlyId === collection.id;
  const canFold = foldable && onToggleFold !== undefined;
  const isList = collection.kind === "list";
  const noun = isList ? "list" : "calendar";
  const nounTitle = isList ? "List" : "Calendar";
  const visibilityHintId = useId();
  // The submenu always opens so a child can show the value it inherits, which
  // means a child or non-owned row is a submenu of nothing but disabled radios.
  // The trigger names the effective value and why it is fixed, for both AT
  // (`aria-describedby`) and pointer users (`title`).
  const visibilityHint = canChangeVisibility
    ? null
    : isChild
      ? `Visibility is inherited from the parent ${noun}: ${VISIBILITY_LABELS[visibility]}.`
      : `Only a ${noun} you own can change visibility; this one is ${VISIBILITY_LABELS[visibility]}.`;

  return (
    <li
      className={cn(
        "group flex h-8 min-w-0 items-center gap-2 rounded-sm px-3 hover:bg-well",
        isChild && "ml-5",
        isOnly && "bg-well",
      )}
    >
      {/* Every row reserves the disclosure column, so checkboxes line up whether
          or not the root has children and whether or not the branch is open. */}
      {canFold ? (
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${collection.name}`}
          aria-expanded={expanded}
          aria-controls={controlsId}
          onClick={onToggleFold}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-ink-mute hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <ChevronRightIcon
            size={14}
            className={cn("transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span aria-hidden className="h-5 w-5 shrink-0" />
      )}
      <Checkbox label={collection.name} checked={checked} onCheckedChange={onToggle} />
      {/* One fixed column for the kind marker: a calendar keeps the 2.5px hue
          swatch, a list gets the list glyph in the same family shade. The
          container reserves the glyph width so names align across kinds. */}
      <span
        aria-hidden
        data-testid={`collection-kind-${collection.kind}`}
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: tokens.main }}
      >
        {isList ? (
          <ListIcon size={14} />
        ) : (
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: tokens.main }} />
        )}
      </span>
      <span
        className={cn("min-w-0 flex-1 truncate text-base", readOnly ? "text-ink-soft" : "text-ink")}
      >
        {collection.name}
      </span>
      {/* The visual kind marker is decorative; this gives the row a spoken kind
          without changing the checkbox name or the options button's label. */}
      <span className="sr-only">{nounTitle}</span>
      {visibilityHint === null ? null : (
        <span id={visibilityHintId} className="sr-only">
          {visibilityHint}
        </span>
      )}
      {visibility === "private" ? (
        <LockIcon size={14} title="Private" className="shrink-0 text-ink-mute" />
      ) : showViewOnlyBadge ? (
        <LockIcon size={14} title="View only" className="shrink-0 text-ink-mute" />
      ) : null}

      {!isChild && childShades.length > 0 ? (
        <span
          aria-hidden
          data-testid={`shade-strip-${collection.name.toLowerCase()}`}
          className="flex shrink-0 gap-0.5"
        >
          {childShades.map((shade, index) => (
            <span
              key={index}
              className="h-2.5 w-1 rounded-sm"
              style={{ background: shade, opacity: 0.9 - index * 0.12 }}
            />
          ))}
        </span>
      ) : null}

      {/* Zero draws nothing: an active list with no open tasks is not worth a
          badge, and an absent count (query disabled/not loaded yet) must not
          flash a misleading "0". */}
      {taskCount !== undefined && taskCount > 0 ? (
        <span
          data-testid={`collection-task-count-${collection.id}`}
          title={`${taskCount} active ${taskCount === 1 ? "task" : "tasks"}`}
          className="rounded-pill shrink-0 bg-well px-1.5 text-xs font-bold text-ink-soft"
        >
          {taskCount}
        </span>
      ) : null}

      {/* Same reveal contract as the options trigger: hidden on fine pointers
          until the row is hovered or holds focus, always visible on touch. */}
      {onQuickAdd ? (
        <button
          type="button"
          aria-label={`Add a task to ${collection.name}`}
          data-testid="sidebar-quick-add"
          onClick={onQuickAdd}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-mute transition-opacity",
            "opacity-0 hover:text-ink focus-visible:opacity-100",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            "[@media(pointer:coarse)]:opacity-100",
          )}
        >
          <PlusIcon size={16} />
        </button>
      ) : null}

      {/* The menu now renders for view-only calendars too: isolating one for a
          read is exactly what that row is for, even though editing is locked. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${collection.name}`}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-mute transition-opacity",
            "opacity-0 hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100",
            "group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <MoreVerticalIcon size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!isChild && !readOnly ? (
            <DropdownMenuItem onSelect={onAddChild}>Add sub-{noun}</DropdownMenuItem>
          ) : null}
          {readOnly ? null : (
            <DropdownMenuItem onSelect={onEdit}>
              {isChild ? "Rename" : `${nounTitle} settings`}
            </DropdownMenuItem>
          )}
          {readOnly ? null : (
            <DropdownMenuItem danger onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {/* The submenu always opens so a child can show the value it inherits;
              only the options are disabled, because children cannot own a
              visibility of their own. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              aria-describedby={visibilityHint === null ? undefined : visibilityHintId}
              title={visibilityHint ?? undefined}
            >
              Visibility
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={visibility}
                onValueChange={(next) => {
                  if (next !== visibility) {
                    onSetVisibility(next as CollectionVisibility);
                  }
                }}
              >
                <DropdownMenuRadioItem value="shared" disabled={!canChangeVisibility}>
                  Shared
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="view_only" disabled={!canChangeVisibility}>
                  View only
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="private" disabled={!canChangeVisibility}>
                  Private
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {/* Isolation filters the event grid, so only calendars offer it. A
              list must never assume it draws events; an already-isolated row
              (however it got that way) always offers the way back. */}
          {isOnly || !isList ? (
            <>
              <DropdownMenuSeparator />
              {isOnly ? (
                <DropdownMenuItem onSelect={onShowAll}>Display all calendars</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onShowOnly}>Display only this calendar</DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
