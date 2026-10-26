"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon, XIcon } from "@/components/ui/icons";
import { isHueFamily, shadeTokens } from "@/lib/color/palette";
import { useUpdateTask } from "@/lib/query/tasks";
import type { TaskView } from "@/lib/services/tasks";
import { cn } from "@/lib/utils";
import { TaskDateChips } from "./TaskDateChips";
import { TaskPriorityFlag } from "./TaskPriorityFlag";
import { TaskStatusPill } from "./TaskStatusPill";
import type { TaskActions, WritableList } from "./types";

interface Props {
  /** The task to show; `null` renders nothing (the panel is unmounted, so the page keys work). */
  task: TaskView | null;
  /** Household-local today, for the date chips' pickers and the overdue cue. */
  today: string;
  /** Close (Esc, the header button, Delete). The shell returns focus to the row. */
  onClose(): void;
  /** Task-bound callbacks built by the shell (title, status, priority, dates, move, delete). */
  actions: TaskActions;
  /** Writable lists the task may move to; the current list is filtered out here. */
  moveTargets: WritableList[];
  /** Task 5's replace contract: the complete checklist, in display order. */
  onChecklist(items: { title: string; done: boolean }[]): void;
}

/** The one editable title recipe: bold, borderless until hover/focus, violet ring. */
const TITLE =
  "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-lg font-bold text-ink transition-colors hover:border-field focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11";

const TEXTAREA =
  "min-h-24 w-full resize-y rounded-md border border-field bg-surface px-3 py-2 text-base text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const INPUT =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [@media(pointer:coarse)]:h-11";

const CHIP =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-1.5 text-xs text-ink-soft transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11";

/**
 * The tasks area's primary button recipe: violet-press fill with white text
 * (5.15:1, WCAG AA for small text; the plain `--color-violet` fill is 4.15:1 and
 * fails). The shared `Button` primary is the app's accent-blue, which is
 * deliberately not used inside the tasks workspace.
 */
const PRIMARY =
  "inline-flex h-[38px] shrink-0 items-center justify-center rounded-md bg-violet-press px-3 text-base font-bold text-white transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11";

/** The task's list shade, the same fallback the row uses for an unstyled collection. */
function listDot(task: TaskView): string {
  const hue = task.collection.hueFamily;
  return hue !== null && isHueFamily(hue)
    ? shadeTokens(hue, task.collection.shadeIndex).main
    : "var(--color-ink-mute)";
}

/**
 * The right slide-over task panel: an inline title, the status/priority/date
 * pickers, a list chip with the move menu, notes, the checklist and the
 * Complete / Drop / Delete actions. It replaces the v0.2.0 modal editor, so the
 * list/board behind it stays visible and clickable (`aria-modal="false"`, no
 * backdrop, no focus trap).
 *
 * `TasksShell` opens it from `Enter`, a row/card title click, a row menu's
 * `Open` and the `?task=` deep link, and hands it `actions` already bound to
 * this task plus the `onChecklist` replace callback. Title edits go through
 * `actions.onTitle` and are deliberately silent (retyping reverts them);
 * status/priority/date/list changes go through the same toast + targeted-undo
 * shell helpers the row uses. Notes are this panel's own PATCH on blur (the
 * panel owns the textarea draft), and the checklist is replaced wholesale on
 * every add/toggle/remove — Task 5's contract — through `onChecklist`.
 *
 * Escape closes — and before it does, it blurs a focused title/notes field so
 * the draft goes through the same blur save instead of being discarded — and the
 * panel consumes the key so the page's triage layer does not also clear the
 * selection; while one of its Radix menus or popovers is open that layer owns
 * Escape instead, so the panel only listens when no `[role="menu"]`/popper
 * wrapper is mounted. Focus lands on the title input on open, and the
 * title/notes drafts re-seed from the server snapshot whenever the field is not
 * focused (so an optimistic rollback after a 403 shows the stored value again).
 */
export function TaskPanel(props: Props) {
  const { task } = props;
  if (task === null) {
    return null;
  }
  // Keyed by id so opening another task starts from that task's snapshot.
  return <TaskPanelBody key={task.id} {...props} task={task} />;
}

function TaskPanelBody({ task, today, onClose, actions, moveTargets, onChecklist }: Props & {
  task: TaskView;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [newItem, setNewItem] = useState("");
  const titleRef = useRef<HTMLInputElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const updateTask = useUpdateTask();

  const items = task.checklist.map((item) => ({ title: item.title, done: item.done }));
  const targets = moveTargets.filter((target) => target.id !== task.collectionId);
  const dot = listDot(task);

  // Re-seed a field from the live task whenever it changes underneath the draft
  // (the optimistic PATCH echo, or its rollback after a rejected write). A
  // focused field keeps what is being typed; leaving it runs the save.
  useEffect(() => {
    if (titleRef.current !== null && document.activeElement === titleRef.current) {
      return;
    }
    setTitle(task.title);
  }, [task.title]);

  useEffect(() => {
    if (notesRef.current !== null && document.activeElement === notesRef.current) {
      return;
    }
    setNotes(task.notes ?? "");
  }, [task.notes]);

  // Escape closes the panel. It is consumed here (capture phase, then
  // `stopPropagation`) so the page-scoped triage layer never also clears the
  // selection on the same key. Radix menus/popovers are the exception: the
  // topmost `DismissableLayer` owns Escape while one is open, and a second open
  // dialog (the `?` sheet) keeps its own Escape, so both bail out first.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }
      if (
        document.querySelector('[role="menu"], [data-radix-popper-content-wrapper]') !== null ||
        document.querySelectorAll('[role="dialog"]').length > 1
      ) {
        return;
      }
      // An open draft must not be silently discarded: blurring the field runs
      // the same commit the pointer path uses (`commitTitle`/`saveNotes`) before
      // the close unmounts the panel.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.matches("input, textarea") &&
        active.closest('[data-testid="task-panel"]') !== null
      ) {
        active.blur();
      }
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  /** Blur/Enter on the title: empty reverts, a real change is one silent PATCH. */
  function commitTitle(): void {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitle(task.title);
      return;
    }
    setTitle(trimmed);
    if (trimmed === task.title) {
      return;
    }
    actions.onTitle(trimmed);
  }

  /** Blur on the notes: blank clears the column, otherwise the draft is saved. */
  function saveNotes(): void {
    const next = notes.trim().length === 0 ? null : notes;
    if (next === task.notes) {
      return;
    }
    updateTask.mutate(
      { id: task.id, notes: next },
      {
        onError: () => {
          // The optimistic patch rolled back; re-seed the draft from the row.
          setNotes(task.notes ?? "");
          toast.error("Could not save the notes.");
        },
      },
    );
  }

  function replaceItems(next: { title: string; done: boolean }[]): void {
    onChecklist(next);
  }

  function addItem(): void {
    const value = newItem.trim();
    if (value.length === 0) {
      return;
    }
    replaceItems([...items, { title: value, done: false }]);
    setNewItem("");
  }

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`Task details: ${task.title}`}
      data-testid="task-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line-strong bg-surface shadow-menu md:w-[440px]"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs text-ink-mute" title={`${task.collection.name} / ${task.title}`}>
          <span className="text-ink-soft">{task.collection.name}</span>
          <span aria-hidden> / </span>
          <span>{task.title}</span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Close task"
          onClick={onClose}
          className="shrink-0 text-ink-soft [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        >
          <XIcon size={16} />
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <div>
          <label htmlFor="task-panel-title" className="sr-only">
            Title
          </label>
          <input
            ref={titleRef}
            id="task-panel-title"
            data-testid="task-panel-title"
            type="text"
            value={title}
            autoFocus
            autoComplete="off"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Enter saves the title; it must not submit or open anything
                // else. Focus deliberately stays in the field, so the blur that
                // would otherwise re-run the commit against the not-yet-updated
                // prop cannot fire a second PATCH.
                event.preventDefault();
                commitTitle();
              }
            }}
            className={TITLE}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <TaskStatusPill status={task.status} onChange={actions.onStatus} />
          <TaskPriorityFlag priority={task.priority} onChange={actions.onPriority} />
          <TaskDateChips
            scheduledOn={task.scheduledOn}
            dueOn={task.dueOn}
            today={today}
            title={task.title}
            onChange={actions.onDates}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`List: ${task.collection.name}`}
                data-testid="task-panel-list"
                className={cn(CHIP, "max-w-44")}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: dot }}
                />
                <span className="truncate">{task.collection.name}</span>
                <ChevronDownIcon size={12} className="shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {targets.length === 0 ? (
                <DropdownMenuItem disabled onSelect={() => undefined}>
                  No other list
                </DropdownMenuItem>
              ) : (
                targets.map((target) => (
                  <DropdownMenuItem key={target.id} onSelect={() => actions.onMove(target.id)}>
                    {target.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <label htmlFor="task-panel-notes" className="block text-sm font-bold text-ink-soft">
            Notes
          </label>
          <textarea
            ref={notesRef}
            id="task-panel-notes"
            data-testid="task-panel-notes"
            value={notes}
            maxLength={2000}
            rows={5}
            placeholder="Add notes…"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={saveNotes}
            className={TEXTAREA}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-ink-soft">Checklist</legend>
          {items.length === 0 ? (
            <p className="text-sm text-ink-mute">No checklist items yet.</p>
          ) : (
            <ul className="space-y-1">
              {task.checklist.map((item, index) => (
                <li key={item.id} className="flex items-center gap-3">
                  <Checkbox
                    label={item.title}
                    checked={item.done}
                    onCheckedChange={(checked) =>
                      replaceItems(
                        items.map((candidate, position) =>
                          position === index ? { ...candidate, done: checked } : candidate,
                        ),
                      )
                    }
                    className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-base",
                      item.done ? "text-ink-mute line-through" : "text-ink",
                    )}
                  >
                    {item.title}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${item.title}`}
                    onClick={() =>
                      replaceItems(items.filter((_, position) => position !== index))
                    }
                    className="shrink-0 text-ink-soft [@media(pointer:coarse)]:min-h-11"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="task-panel-new-item" className="sr-only">
                New checklist item
              </label>
              <input
                id="task-panel-new-item"
                type="text"
                value={newItem}
                autoComplete="off"
                maxLength={200}
                placeholder="Add an item…"
                onChange={(event) => setNewItem(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    // Enter adds a checklist row instead of doing anything else.
                    event.preventDefault();
                    addItem();
                  }
                }}
                className={INPUT}
              />
            </div>
            <Button
              type="button"
              onClick={addItem}
              disabled={newItem.trim().length === 0}
              className="shrink-0 [@media(pointer:coarse)]:min-h-11"
            >
              Add item
            </Button>
          </div>
        </fieldset>

        <p className="text-xs text-ink-mute">
          Esc closes the panel and saves a pending title/notes draft; both also
          save when the field loses focus.
        </p>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <button
          type="button"
          disabled={task.status === "done"}
          onClick={() => actions.onToggleDone(true)}
          className={PRIMARY}
        >
          Complete
        </button>
        <Button
          type="button"
          variant="outline"
          disabled={task.status === "dropped"}
          onClick={actions.onDrop}
          className="[@media(pointer:coarse)]:min-h-11"
        >
          Drop
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={actions.onDelete}
          className="ml-auto text-danger-ink [@media(pointer:coarse)]:min-h-11"
        >
          Delete
        </Button>
      </footer>
    </aside>
  );
}
