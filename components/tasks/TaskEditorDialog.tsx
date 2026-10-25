"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useState } from "react";
import { toast } from "sonner";
import { DatePickerPopover } from "@/components/calendar/DatePickerPopover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CalendarIcon } from "@/components/ui/icons";
import { useUpdateTask } from "@/lib/query/tasks";
import type { TaskView } from "@/lib/services/tasks";
import { formatWallDate } from "@/lib/time/format";
import { cn } from "@/lib/utils";
import type { UpdateTaskInput } from "@/lib/validation/tasks";

interface Props {
  /** The task to edit; `null` renders the closed dialog. */
  task: TaskView | null;
  /** Household-local today, for the due-date picker's Today shortcut. */
  today: string;
  /** Escape, Cancel or a successful save. The shell returns focus to the row. */
  onClose: () => void;
  /** Delete from the editor. The shell owns the mutation and its undo toast. */
  onDelete: (task: TaskView) => void;
}

interface ItemDraft {
  /** Stable React key; new rows never reach the server with this. */
  key: string;
  title: string;
  done: boolean;
}

// The Canvas form recipes (EventDialog/CollectionDialog): 38px box, 1px field
// border, 4px radius, 16px text, 44px tall on a coarse pointer.
const CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [@media(pointer:coarse)]:h-11";
const TEXTAREA =
  "min-h-24 w-full resize-y rounded-md border border-field bg-surface px-3 py-2 text-base text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LABEL = "block text-base text-ink";

/**
 * The task editor: title, notes, due date and checklist for one task, with
 * Save and Delete. It is a deliberate form save, so it owns its draft state and
 * PATCHes the whole editable payload at once (`title`, `notes`, `dueOn`, the
 * complete `checklist` array — Task 5's replace contract). It is opened by
 * `TasksShell` (`Enter`, the row's "Edit task…" action, or Task 11's `?task=`
 * deep link) and only renders while a task is supplied.
 *
 * Escape, Cancel and a successful save close it; `TasksShell` then restores
 * focus to the selected row. Server 400s surface as an error toast (the shared
 * `useUpdateTask` throws the envelope's message); the empty-title guard is the
 * field-level error and also disables Save.
 */
export function TaskEditorDialog({ task, today, onClose, onDelete }: Props) {
  return (
    <Dialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        title="Edit task"
        description="Title, notes, due date and checklist save together."
      >
        {task ? (
          // Keyed by id so every open starts from the server snapshot instead of
          // the previous task's draft.
          <TaskEditorBody key={task.id} task={task} today={today} onClose={onClose} onDelete={onDelete} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskEditorBody({
  task,
  today,
  onClose,
  onDelete,
}: Props & { task: TaskView }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueOn, setDueOn] = useState<string | null>(task.dueOn);
  const [items, setItems] = useState<ItemDraft[]>(() =>
    task.checklist.map((item) => ({ key: item.id, title: item.title, done: item.done })),
  );
  const [newItem, setNewItem] = useState("");
  const [dueOpen, setDueOpen] = useState(false);
  const updateTask = useUpdateTask();

  const trimmedTitle = title.trim();

  function addItem(): void {
    const value = newItem.trim();
    if (value.length === 0) {
      return;
    }
    setItems((current) => [...current, { key: crypto.randomUUID(), title: value, done: false }]);
    setNewItem("");
  }

  function toggleItem(key: string, done: boolean): void {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, done } : item)));
  }

  function removeItem(key: string): void {
    setItems((current) => current.filter((item) => item.key !== key));
  }

  async function save(): Promise<void> {
    if (trimmedTitle.length === 0) {
      return;
    }
    const payload: UpdateTaskInput = {
      title: trimmedTitle,
      // Plain text: blank notes clear the column instead of storing "".
      notes: notes.trim().length === 0 ? null : notes,
      dueOn,
      // Task 5's contract: the whole array replaces the stored checklist.
      checklist: items.map((item) => ({ title: item.title.trim(), done: item.done })),
    };
    try {
      await updateTask.mutateAsync({ id: task.id, ...payload });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the task.");
    }
  }

  return (
    <form
      className="flex max-h-[calc(100dvh-14rem)] flex-col gap-4 overflow-y-auto px-1 max-md:max-h-[calc(92dvh-11rem)]"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-1">
        <label className={LABEL} htmlFor="task-editor-title">
          Title
        </label>
        <input
          id="task-editor-title"
          type="text"
          value={title}
          autoFocus
          autoComplete="off"
          maxLength={200}
          aria-invalid={trimmedTitle.length === 0}
          aria-describedby={trimmedTitle.length === 0 ? "task-editor-title-error" : undefined}
          onChange={(event) => setTitle(event.target.value)}
          className={CONTROL}
        />
        {trimmedTitle.length === 0 ? (
          <p id="task-editor-title-error" role="alert" className="text-sm text-danger-ink">
            Give the task a title.
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label className={LABEL} htmlFor="task-editor-notes">
          Notes
        </label>
        <textarea
          id="task-editor-notes"
          value={notes}
          maxLength={2000}
          rows={4}
          onChange={(event) => setNotes(event.target.value)}
          className={TEXTAREA}
        />
      </div>

      <div className="space-y-1">
        <span id="task-editor-due-label" className={LABEL}>
          Due date
        </span>
        <PopoverPrimitive.Root open={dueOpen} onOpenChange={setDueOpen}>
          {/* Escape belongs to Radix: the highest `DismissableLayer` listens for
              it on `document` in the capture phase, and while this popover is
              open it *is* that layer, so Escape dismisses the calendar and the
              dialog never sees the key. A bubble `stopPropagation` here would be
              a no-op, so there is deliberately none. */}
          <PopoverPrimitive.Trigger asChild>
            <Button
              type="button"
              id="task-editor-due"
              variant="outline"
              aria-labelledby="task-editor-due-label"
              aria-haspopup="dialog"
              aria-expanded={dueOpen}
              data-testid="task-editor-due-trigger"
              className={cn(CONTROL, "justify-between text-left font-normal")}
            >
              <span className={cn("min-w-0 flex-1 truncate", dueOn === null && "text-ink-soft")}>
                {dueOn === null ? "No due date" : formatWallDate(dueOn)}
              </span>
              <CalendarIcon size={16} className="shrink-0 text-ink-soft" />
            </Button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="bottom"
              align="start"
              sideOffset={4}
              collisionPadding={12}
              aria-label="Pick a due date"
              data-testid="task-editor-due-popover"
              className="z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-md border border-line-strong bg-surface p-3 shadow-menu outline-none data-[state=open]:animate-[popover-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
            >
              <DatePickerPopover
                key={dueOn ?? "none"}
                anchorDate={dueOn ?? today}
                selectedDate={dueOn ?? undefined}
                today={today}
                onPick={(date) => {
                  setDueOn(date);
                  setDueOpen(false);
                }}
              />
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={dueOn === null}
                  onClick={() => {
                    setDueOn(null);
                    setDueOpen(false);
                  }}
                >
                  Clear due date
                </Button>
                <span className="text-sm text-ink-mute">
                  {dueOn === null ? "No date" : formatWallDate(dueOn)}
                </span>
              </div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>

      <fieldset className="space-y-2">
        <legend className={LABEL}>Checklist</legend>
        {items.length === 0 ? (
          <p className="text-sm text-ink-mute">No checklist items yet.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.key} className="flex items-center gap-3">
                <Checkbox
                  label={item.title}
                  checked={item.done}
                  onCheckedChange={(checked) => toggleItem(item.key, checked)}
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
                  onClick={() => removeItem(item.key)}
                  className="shrink-0 [@media(pointer:coarse)]:min-h-11"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="task-editor-new-item" className="sr-only">
              New checklist item
            </label>
            <input
              id="task-editor-new-item"
              type="text"
              value={newItem}
              autoComplete="off"
              maxLength={200}
              placeholder="Add an item…"
              onChange={(event) => setNewItem(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Enter adds a checklist row; it must not submit the form
                  // (the title field's Enter is the save gesture).
                  event.preventDefault();
                  addItem();
                }
              }}
              className={CONTROL}
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

      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onDelete(task)}
          className="text-danger-ink [@media(pointer:coarse)]:min-h-11"
        >
          Delete task
        </Button>
        <div className="flex gap-2">
          <Button type="button" onClick={onClose} className="[@media(pointer:coarse)]:min-h-11">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={updateTask.isPending || trimmedTitle.length === 0}
            className="[@media(pointer:coarse)]:min-h-11"
          >
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
