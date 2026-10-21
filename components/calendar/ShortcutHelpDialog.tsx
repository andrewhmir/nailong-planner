"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onClose: () => void;
}

const GROUPS: Array<{ title: string; rows: Array<{ keys: string[]; description: string }> }> = [
  {
    title: "Global",
    rows: [
      { keys: ["/"], description: "Search events" },
      { keys: ["?"], description: "Open this shortcut list" },
      { keys: ["Esc"], description: "Close the open panel" },
    ],
  },
  {
    title: "Calendar",
    rows: [
      { keys: ["c"], description: "Create event" },
      { keys: ["Shift", "C"], description: "Quick create" },
      { keys: ["t"], description: "Go to today" },
      { keys: ["g"], description: "Go to date" },
      { keys: ["j", "n"], description: "Next month / range" },
      { keys: ["k", "p"], description: "Previous month / range" },
      { keys: ["d"], description: "Day view" },
      { keys: ["w"], description: "Week view" },
      { keys: ["m"], description: "Month view" },
      { keys: ["l"], description: "List view" },
    ],
  },
  {
    title: "Editing",
    rows: [
      { keys: ["e"], description: "Edit the selected event" },
      { keys: ["Delete"], description: "Delete the selected event" },
      { keys: ["z"], description: "Undo the last change" },
      { keys: ["Ctrl", "Z"], description: "Undo the last change" },
    ],
  },
];

/** The `?` sheet: discoverable from the Toolbar's "Keyboard shortcuts" button. */
export function ShortcutHelpDialog({ open, onClose }: Props) {
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
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
