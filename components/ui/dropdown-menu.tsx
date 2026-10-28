"use client";

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;

const SURFACE =
  "z-50 min-w-44 rounded-md border border-line-strong bg-surface p-1 shadow-menu";
const ITEM =
  "flex cursor-pointer items-center gap-2 rounded-sm px-4 py-2.5 text-base text-ink outline-none hover:bg-line data-[highlighted]:bg-line data-[disabled]:cursor-default data-[disabled]:opacity-40";

export function DropdownMenuContent({
  children,
  className,
  align = "end",
}: {
  children: React.ReactNode;
  /** Extra classes for the content surface (e.g. a max-height for a long menu). */
  className?: string;
  /** Which edge of the trigger the menu hangs from; `end` for the toolbar menus. */
  align?: "start" | "end";
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={4} className={cn(SURFACE, className)}>
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  /** Receives the DOM event; call `event.preventDefault()` to keep the menu open. */
  onSelect: (event: Event) => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(ITEM, danger ? "text-danger-ink" : "text-ink")}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-4 py-2 text-sm font-bold text-ink">
      {children}
    </DropdownPrimitive.Label>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
}

/** A submenu trigger, styled like an item, with the affordance chevron. */
export function DropdownMenuSubTrigger({
  children,
  disabled = false,
  title,
  "aria-describedby": describedBy,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  /** Native tooltip, for a submenu whose items are all disabled. */
  title?: string;
  /** Id of an `sr-only` explanation rendered by the caller. */
  "aria-describedby"?: string;
}) {
  return (
    <DropdownPrimitive.SubTrigger
      disabled={disabled}
      title={title}
      aria-describedby={describedBy}
      className={cn(ITEM, "data-[state=open]:bg-line")}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRightIcon size={14} className="shrink-0 text-ink-mute" />
    </DropdownPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ children }: { children: React.ReactNode }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent sideOffset={4} alignOffset={-4} className={SURFACE}>
        {children}
      </DropdownPrimitive.SubContent>
    </DropdownPrimitive.Portal>
  );
}

/**
 * A multi-select item with a check indicator, for filter menus. Radix keeps the
 * menu open after a toggle, so several boxes can be ticked in one visit.
 */
export function DropdownMenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  children: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownPrimitive.CheckboxItem
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      disabled={disabled}
      className={cn(ITEM, "data-[state=checked]:font-bold")}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        <DropdownPrimitive.ItemIndicator>
          <CheckIcon size={14} />
        </DropdownPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </DropdownPrimitive.CheckboxItem>
  );
}

/** A radio item with a check indicator, for menus that pick one of a set. */
export function DropdownMenuRadioItem({
  children,
  value,
  disabled = false,
  className,
}: {
  children: React.ReactNode;
  value: string;
  disabled?: boolean;
  /** Extra classes for the item (e.g. the checked background of a picker). */
  className?: string;
}) {
  return (
    <DropdownPrimitive.RadioItem
      value={value}
      disabled={disabled}
      className={cn(ITEM, "data-[state=checked]:font-bold", className)}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        <DropdownPrimitive.ItemIndicator>
          <CheckIcon size={14} />
        </DropdownPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </DropdownPrimitive.RadioItem>
  );
}
