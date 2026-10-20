"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { LockIcon, MoreVerticalIcon } from "@/components/ui/icons";
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
  onToggle: () => void;
  onAddChild: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function CalendarRow({
  calendar,
  checked,
  isChild,
  ownerHue,
  childShades,
  readOnly,
  showViewOnlyBadge,
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
}: Props) {
  const tokens = shadeTokens(ownerHue, isChild ? calendar.shadeIndex : PARENT_SHADE_INDEX);

  return (
    <li
      className={cn(
        "group flex h-8 min-w-0 items-center gap-2 rounded-sm px-3 hover:bg-well",
        isChild && "ml-5",
      )}
    >
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

      {readOnly ? null : (
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
            {!isChild ? (
              <DropdownMenuItem onSelect={onAddChild}>Add sub-calendar</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onEdit}>
              {isChild ? "Rename" : "Calendar settings"}
            </DropdownMenuItem>
            <DropdownMenuItem danger onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
