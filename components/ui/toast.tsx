import type { ToasterProps } from "sonner";

// Sonner injects its own unlayered stylesheet at runtime, which outranks
// Tailwind's layered utilities (sonner's `[data-sonner-toast][data-styled]`
// sets radius 8px, a 1px border and its own shadow). The `!` important
// modifiers are what let the Canvas flash metrics actually render.
export const TOASTER_PROPS: ToasterProps = {
  position: "top-center",
  closeButton: true,
  toastOptions: {
    classNames: {
      toast: "rounded-lg! border-2! bg-surface! shadow-flash! text-ink!",
      success: "border-success!",
      error: "border-danger!",
      warning: "border-warning!",
      info: "border-line-strong!",
    },
  },
};
