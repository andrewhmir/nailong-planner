"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronRightIcon, LockIcon, MoreVerticalIcon } from "@/components/ui/icons";
import { PARENT_SHADE_INDEX, shadeTokens, type HueFamily } from "@/lib/color/palette";
import type { CalendarRow as CalendarRowType } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

interface Props {
  calendar: CalendarRowType;
  checked: boolean;
  isChild: boolean;
  ownerHue: HueFamily;
  childShades: string[];
  readOnly: boolean;
  showViewOnlyBadge: boolean;
  /** The calendar "display only this calendar" is showing, if any. */
  onlyId: string | null;
  /** Root rows with sub-calendars get a disclosure button. */
  foldable?: boolean;
  /** Whether this root's sub-calendars are currently shown. */
  expanded?: boolean;
  /** id of the sub-calendar list this row's disclosure button controls. */
  controlsId?: string;
  onToggleFold?: () => void;
  onToggle: () => void;
  onAddChild: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowOnly: () => void;
  onShowAll: () => void;
}

export function CalendarRow({
  calendar,
  checked,
  isChild,
  ownerHue,
  childShades,
  readOnly,
  showViewOnlyBadge,
  onlyId,
  foldable = false,
  expanded = true,
  controlsId,
  onToggleFold,
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
  onShowOnly,
  onShowAll,
}: Props) {
  const tokens = shadeTokens(ownerHue, isChild ? calendar.shadeIndex : PARENT_SHADE_INDEX);
  const isOnly = onlyId === calendar.id;
  const canFold = foldable && onToggleFold !== undefined;

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
          aria-label={`${expanded ? "Collapse" : "Expand"} ${calendar.name}`}
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
      <Checkbox label={calendar.name} checked={checked} onCheckedChange={onToggle} />
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ background: tokens.main }}
      />
      <span
        className={cn("min-w-0 flex-1 truncate text-base", readOnly ? "text-ink-soft" : "text-ink")}
      >
        {calendar.name}
      </span>
      {showViewOnlyBadge ? (
        <LockIcon size={14} title="View only" className="shrink-0 text-ink-mute" />
      ) : null}

      {!isChild && childShades.length > 0 ? (
        <span
          aria-hidden
          data-testid={`shade-strip-${calendar.name.toLowerCase()}`}
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

      {/* The menu now renders for view-only calendars too: isolating one for a
          read is exactly what that row is for, even though editing is locked. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${calendar.name}`}
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
            <DropdownMenuItem onSelect={onAddChild}>Add sub-calendar</DropdownMenuItem>
          ) : null}
          {readOnly ? null : (
            <DropdownMenuItem onSelect={onEdit}>
              {isChild ? "Rename" : "Calendar settings"}
            </DropdownMenuItem>
          )}
          {readOnly ? null : (
            <DropdownMenuItem danger onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {isOnly ? (
            <DropdownMenuItem onSelect={onShowAll}>Display all calendars</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onShowOnly}>Display only this calendar</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
