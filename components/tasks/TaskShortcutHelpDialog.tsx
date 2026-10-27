"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onClose: () => void;
}

const GROUPS: Array<{ title: string; rows: Array<{ keys: string[]; description: string }> }> = [
  {
    title: "Global",
    rows: [
      { keys: ["Shift", "K"], description: "Capture a task from anywhere" },
      { keys: ["?"], description: "Open this shortcut list" },
    ],
  },
  {
    title: "Triage",
    rows: [
      { keys: ["j"], description: "Next task or card" },
      { keys: ["k"], description: "Previous task or card" },
      { keys: ["1"], description: "Schedule for today" },
      { keys: ["2"], description: "Schedule for the end of this week" },
      { keys: ["3"], description: "Someday: clear the task's dates" },
      { keys: ["4"], description: "Move to the next writable list" },
      { keys: ["x"], description: "Complete the selected task or card" },
      { keys: ["Enter"], description: "Open the selected task in the panel" },
      { keys: ["Escape"], description: "Clear the selection" },
    ],
  },
];

/**
 * The `?` sheet on `/tasks`: the global capture gesture plus the triage keys.
 * Same dialog primitives as the calendar's `ShortcutHelpDialog`, but a separate
 * group set because `j`/`k` mean something else here (row/card selection, not
 * period navigation), and a closing note that spells out the board's drag/menu
 * status path and the no-within-column-reorder rule.
 */
export function TaskShortcutHelpDialog({ open, onClose }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent
        title="Keyboard shortcuts"
        description="Single-key shortcuts can be turned off in Settings → Calendar."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className="min-w-0">
              <h3 className="mb-2 text-sm font-bold text-ink-soft">{group.title}</h3>
              <dl className="space-y-1.5">
                {group.rows.map((row) => (
                  <div key={row.description} className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-ink">{row.description}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {row.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded-sm border border-line-strong bg-well px-1.5 py-0.5 text-xs text-ink"
                        >
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Board view: j / k move through the cards in column order, x completes the selected card,
          and a card&apos;s menu or a drag between columns changes its status (there is no
          within-column reorder).
        </p>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
