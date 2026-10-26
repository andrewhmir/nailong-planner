"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";

/**
 * Google Calendar's recurring-scope chooser: the three radio-like options a
 * repeating event offers when it is dragged, resized, edited or deleted. The
 * surrounding `DialogContent` owns the title; this body only lays out the
 * description, the optional disabled-option note and the actions, and is also
 * reused inside the Edit dialog when saving.
 */

export type RecurringScope = "this" | "following" | "all";

export interface ScopeDialogProps {
  /** One sentence explaining what the choice controls. */
  description: string;
  /** Shown when some options are disabled (e.g. a custom repeat rule). */
  note?: string;
  /** Options that cannot be applied to this event. */
  disabled?: RecurringScope[];
  onChoose: (scope: RecurringScope) => void;
  onCancel: () => void;
}

const OPTIONS: Array<{ scope: RecurringScope; label: string }> = [
  { scope: "this", label: "This event" },
  { scope: "following", label: "This and following events" },
  { scope: "all", label: "All events" },
];

export function ScopeDialog({
  description,
  note,
  disabled = [],
  onChoose,
  onCancel,
}: ScopeDialogProps) {
  const noteId = useId();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-soft">{description}</p>
      {note ? (
        <p id={noteId} className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink">
          {note}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const disabledReason = disabled.includes(option.scope);
          return (
            <Button
              key={option.scope}
              variant={option.scope === "all" ? "primary" : "outline"}
              disabled={disabledReason}
              aria-describedby={disabledReason && note ? noteId : undefined}
              onClick={() => onChoose(option.scope)}
            >
              {option.label}
            </Button>
          );
        })}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
