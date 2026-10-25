"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useCreateTask, useDeleteTask } from "@/lib/query/tasks";
import { usePreferences } from "@/lib/query/preferences";
import type { UserPreferences } from "@/lib/services/preferences";
import { hasOpenOverlay, isTextEntryTarget } from "@/lib/ui/shortcutGuards";
import { pushUndo } from "@/lib/ui/undo";
import { undoToast } from "@/lib/ui/undoToast";

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
 * success toast's Undo is bound to this capture's own stack handle, so it deletes
 * exactly this task even if another undoable change lands inside the 10-second
 * window (`z`/`Ctrl+Z` still undo the shared stack LIFO). Closing the dialog
 * returns focus to whatever was focused when it opened — except while the create
 * is in flight, when the dialog holds still because a dismissal could not stop
 * the POST and would leave a task the user tried to cancel.
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

  /**
   * `force` is only for the success path. A dismissal while the POST is pending
   * is ignored: the request cannot be aborted, so closing the dialog would still
   * create the task the user meant to cancel.
   */
  function close(force = false): void {
    if (!force && createTask.isPending) {
      return;
    }
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
          close(true);
          const handle = pushUndo({
            label: "Capture task",
            undo: async () => {
              await deleteTask.mutateAsync(task.id);
            },
          });
          undoToast("Task captured", handle);
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
            <Button
              onClick={() => close()}
              disabled={createTask.isPending}
              className="[@media(pointer:coarse)]:min-h-11"
            >
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
