"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  sheet = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /**
   * Phones get a bottom sheet instead of a centred box: full width, pinned to
   * the bottom, square top corners, so a long form scrolls above the keyboard.
   */
  sheet?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-testid="dialog-overlay" className="fixed inset-0 z-40 bg-scrim" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh_-_var(--safe-top)_-_var(--safe-bottom)_-_1rem)] w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-md bg-surface pt-6 safe-x-6 safe-pb-6 shadow-dialog outline-none",
          sheet &&
            "max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:left-0 max-md:max-h-[92dvh] max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none",
        )}
      >
        <DialogPrimitive.Title className="text-xl font-normal text-ink">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-sm text-ink-soft">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        <div className="mt-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
