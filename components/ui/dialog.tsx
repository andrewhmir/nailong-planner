"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Publish the *visual* viewport as CSS variables. iOS does not resize the
 * layout viewport when the keyboard opens, so `dvh` alone cannot keep a
 * dialog's footer above the keyboard: the dialog is positioned and sized
 * inside this box instead (0/100dvh fallback when visualViewport is missing).
 */
function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const root = document.documentElement;

    function update(): void {
      root.style.setProperty("--app-vv-height", `${viewport!.height}px`);
      root.style.setProperty("--app-vv-top", `${viewport!.offsetTop}px`);
    }

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
}

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
   * the visual viewport bottom, square top corners, so a long form scrolls
   * above the keyboard.
   */
  sheet?: boolean;
}) {
  useVisualViewport();

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-testid="dialog-overlay" className="fixed inset-0 z-40 bg-scrim" />
      {/* The overlay is the layout viewport; this box is the visual viewport, so
          the card and its sticky footer stay above the on-screen keyboard. */}
      <div
        data-testid="dialog-viewport"
        className="fixed inset-x-0 z-50 flex items-center justify-center px-2"
        style={{ top: "var(--app-vv-top, 0px)", height: "var(--app-vv-height, 100dvh)" }}
      >
        <DialogPrimitive.Content
          className={cn(
            "relative max-h-full w-[min(28rem,92vw)] overflow-y-auto overscroll-contain rounded-md bg-surface pt-6 safe-x-6 safe-pb-6 shadow-dialog outline-none",
            sheet && "max-md:w-full max-md:max-w-none max-md:self-end max-md:rounded-b-none",
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
      </div>
    </DialogPrimitive.Portal>
  );
}