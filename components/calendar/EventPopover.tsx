"use client";

import { Button } from "@/components/ui/button";
import type { EventView } from "@/lib/services/events";
import type { TimeFormat } from "@/lib/services/preferences";
import { formatOccurrenceWhen } from "@/lib/time/format";

interface Props {
  event: EventView;
  occurrenceStart: string;
  color: string;
  timezone: string;
  timeFormat: TimeFormat;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function EventPopover({
  event,
  occurrenceStart,
  color,
  timezone,
  timeFormat,
  readOnly,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const when = formatOccurrenceWhen(event, occurrenceStart, timezone, timeFormat);

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-md border border-line-strong bg-surface p-4 shadow-menu sm:inset-x-auto sm:right-6 sm:bottom-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ background: color }}
        />
        <div className="min-w-0">
          <h3 className="truncate text-base font-normal text-ink">{event.title}</h3>
          <p className="text-sm text-ink-soft">{when}</p>
          {event.description ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{event.description}</p>
          ) : null}
          {event.rrule ? (
            <p className="mt-1 text-xs font-bold text-ink">Repeats</p>
          ) : null}
          {readOnly ? (
            <p className="mt-2 rounded-md bg-well px-3 py-2 text-sm text-ink-soft">
              View only — you can’t edit this calendar.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
        {readOnly ? null : (
          <>
            <Button size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="primary" onClick={onDelete}>
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
