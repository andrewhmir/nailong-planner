"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { EventDetails, type EventDetailsProps } from "./EventDetails";

interface Props extends EventDetailsProps {
  /** The clicked event block's viewport rect; anchors the desktop popover. */
  anchorRect: DOMRect;
  /** Focus returns here when the popover closes. */
  anchorElement: HTMLElement | null;
}

/**
 * Anchored details surface. Desktop is a Radix popover pinned to the clicked
 * event block; below 768 px the same body renders in a dialog so it cannot be
 * clipped by the narrow grid. Radix owns Escape, outside-click and focus trap.
 */
export function EventDetailsPopover({ anchorRect, anchorElement, ...details }: Props) {
  const isPhone = useMediaQuery("(max-width: 767px)");
  const contentRef = useRef<HTMLDivElement | null>(null);

  if (isPhone) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            details.onClose();
          }
        }}
      >
        <DialogContent title="Event details">
          <EventDetails {...details} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <PopoverPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          details.onClose();
        }
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: anchorRect.left,
            top: anchorRect.top,
            width: 1,
            height: 1,
          }}
        />
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const content = contentRef.current;
            const target =
              content?.querySelector<HTMLElement>('[data-action="edit"]') ??
              content?.querySelector<HTMLElement>("button");
            target?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            anchorElement?.focus();
          }}
          className="z-50 w-[22rem] max-w-sm rounded-md border border-line-strong bg-surface p-4 shadow-menu outline-none"
        >
          <EventDetails {...details} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
