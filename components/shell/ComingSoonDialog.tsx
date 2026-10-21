"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { gateLabel, type RoadmapEntry } from "@/lib/roadmap";

interface Props {
  /** The gated rail destination, or null when the dialog is closed. */
  entry: RoadmapEntry | null;
  onClose: () => void;
}

/**
 * The "what's coming" dialog behind a gated rail destination.
 *
 * It is the honest version of a disabled nav item: the destination exists on the
 * roadmap, says which release it belongs to, and lists what it will do. State is
 * controlled by the shell so the rail, the phone drawer and the dialog share one
 * instance — and so focus can return to whichever control opened it.
 */
export function ComingSoonDialog({ entry, onClose }: Props) {
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {entry ? (
        <DialogContent title={entry.label} description={entry.blurb} sheet>
          <p className="text-sm font-bold uppercase tracking-wide text-ink-mute">
            {gateLabel(entry)}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-ink-soft">
            {entry.capabilities.map((capability) => (
              <li key={capability} className="flex gap-2">
                <span aria-hidden className="text-accent">
                  •
                </span>
                <span>{capability}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <DialogClose asChild>
              <Button variant="primary" size="sm">
                Got it
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
