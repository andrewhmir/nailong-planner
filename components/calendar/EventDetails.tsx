"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { describeRrule } from "@/lib/recurrence/label";
import type { EventView } from "@/lib/services/events";
import type { TimeFormat } from "@/lib/services/preferences";
import { formatOccurrenceHeading, formatOccurrenceWhen } from "@/lib/time/format";

/** The description is clamped until the reader asks for the rest. */
const CLAMPED_DESCRIPTION_LENGTH = 140;

export interface EventDetailsProps {
  event: EventView;
  calendarName: string;
  color: string;
  timezone: string;
  timeFormat: TimeFormat;
  occurrenceStart: string;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}

/**
 * Presentational details body, shared by the desktop popover and the mobile
 * sheet. The wrapper owns dialog semantics and focus; this component only lays
 * out the facts and the actions.
 */
export function EventDetails({
  event,
  calendarName,
  color,
  timezone,
  timeFormat,
  occurrenceStart,
  readOnly,
  onEdit,
  onDelete,
  onDuplicate,
  onClose,
}: EventDetailsProps) {
  const [expanded, setExpanded] = useState(false);

  const heading = formatOccurrenceHeading(event, occurrenceStart, timezone);
  const when = formatOccurrenceWhen(event, occurrenceStart, timezone, timeFormat);
  const repeat = event.rrule ? describeRrule(event.rrule) : "";
  const location = event.location?.trim() ?? "";
  const description = event.description?.trim() ?? "";

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ background: color }}
        />
        <div className="min-w-0">
          <h3 className="break-words text-xl font-normal text-ink">{event.title}</h3>
          <p className="mt-1 text-sm text-ink">{heading}</p>
          <p className="text-sm text-ink-soft">{when}</p>
        </div>
      </div>

      {repeat ? <p className="text-sm text-ink-soft">{repeat}</p> : null}

      {calendarName ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: color }}
          />
          {calendarName}
        </p>
      ) : null}

      {location ? (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
          target="_blank"
          rel="noreferrer"
          className="block break-words text-sm text-link hover:underline"
        >
          {location}
        </a>
      ) : null}

      {description ? (
        <div>
          <p
            className={
              expanded
                ? "whitespace-pre-wrap break-words text-sm text-ink-soft"
                : "line-clamp-3 whitespace-pre-wrap break-words text-sm text-ink-soft"
            }
          >
            {description}
          </p>
          {description.length > CLAMPED_DESCRIPTION_LENGTH ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 text-sm text-link hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}

      {readOnly ? (
        <p className="rounded-md bg-well px-3 py-2 text-sm text-ink-soft">
          View only — you can’t edit this calendar.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {readOnly ? null : (
          <>
            <Button size="sm" data-action="edit" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" onClick={onDuplicate}>
              Duplicate
            </Button>
          </>
        )}
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
        {readOnly ? null : (
          <Button
            size="sm"
            aria-label="Delete"
            onClick={onDelete}
            className="border border-danger-ink text-danger-ink hover:bg-danger-soft"
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
