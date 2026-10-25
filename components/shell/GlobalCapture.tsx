"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useCreateTask, useDeleteTask } from "@/lib/query/tasks";
import { usePreferences } from "@/lib/query/preferences";
import type { UserPreferences } from "@/lib/services/preferences";
import { hasOpenOverlay, isTextEntryTarget } from "@/lib/ui/shortcutGuards";
import { pushUndo, undoLast } from "@/lib/ui/undo";

interface Props {
  /**
   * The server's snapshot of the current user's preferences, used as
   * `usePreferences`'s initial data. Reading the preference through that hook
   * (rather than a plain prop) keeps the gesture in step when the Settings
   * toggle is flipped in this session: the mutation updates the shared query
   * cache and this listener re-subscribes immediately.
   */
  initialPreferences: UserPreferences;
}

// The same Canvas field recipe as the page capture bar.
const FIELD =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink placeholder:text-placeholder focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 [@media(pointer:coarse)]:h-11";

/**
 * Global quick capture: `Shift+K` anywhere in the app opens a one-field dialog
 * and `Enter` files the title in the caller's Inbox without navigating. The
 * success toast carries the only undo path for a capture (the delete of the row
 * just created); closing the dialog returns focus to whatever was focused when
 * it opened.
 *
 * Mounted once by `AppShell`, so it works on `/` and `/tasks` alike. The gesture
 * is gated on the same `shortcutsEnabled` preference as the page-scoped
 * shortcuts and is ignored while typing or while any dialog/menu is open.
 */
export function GlobalCapture({ initialPreferences }: Props) {
  const preferences = usePreferences(initialPreferences);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();

  useEffect(() => {
    if (!preferences.shortcutsEnabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (!event.shiftKey || event.key.toLowerCase() !== "k") {
        return;
      }
      if (isTextEntryTarget(event.target) || hasOpenOverlay()) {
        return;
      }
      event.preventDefault();
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preferences.shortcutsEnabled]);

  function close(): void {
    setOpen(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // The dialog unmounts on the next paint; return focus after that.
    window.setTimeout(() => {
      if (target && target.isConnected) {
        target.focus();
      }
    }, 0);
  }

  function capture(): void {
    const value = title.trim();
    if (value.length === 0 || createTask.isPending) {
      return;
    }
    createTask.mutate(
      { title: value },
      {
        onSuccess: ({ task }) => {
          setTitle("");
          close();
          pushUndo({
            label: "Capture task",
            undo: async () => {
              await deleteTask.mutateAsync(task.id);
            },
          });
          toast.success("Task captured", {
            action: { label: "Undo", onClick: () => void undoLast() },
            duration: 10_000,
          });
        },
        onError: () => toast.error("Could not add the task."),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DialogContent
        title="Capture a task"
        description="It lands in your Inbox. Enter saves it; Escape cancels."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            capture();
          }}
        >
          <label htmlFor="global-capture-title" className="text-sm font-bold text-ink">
            Task title
          </label>
          <input
            id="global-capture-title"
            type="text"
            value={title}
            autoFocus
            autoComplete="off"
            disabled={createTask.isPending}
            placeholder="What needs doing?"
            onChange={(event) => setTitle(event.target.value)}
            className={`mt-1 ${FIELD}`}
          />
          <div className="mt-4 flex justify-end gap-3">
            <Button onClick={close} className="[@media(pointer:coarse)]:min-h-11">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={createTask.isPending || title.trim().length === 0}
              className="[@media(pointer:coarse)]:min-h-11"
            >
              Add task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
