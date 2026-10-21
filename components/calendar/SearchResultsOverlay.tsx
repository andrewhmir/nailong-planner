"use client";

import type { ReactNode } from "react";
import { useCalendars } from "@/lib/query/calendars";
import { navigableDateFor } from "@/lib/query/search";
import type { EventView } from "@/lib/services/events";
import type { TimeFormat } from "@/lib/services/preferences";
import { formatInstant, formatWallDate } from "@/lib/time/format";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  query: string;
  results: EventView[] | undefined;
  isFetching: boolean;
  activeIndex: number;
  timezone: string;
  timeFormat: TimeFormat;
  /** Inside the mobile dialog the panel sits in flow instead of floating. */
  inline?: boolean;
  onSelect: (event: EventView) => void;
  onActiveIndexChange: (index: number) => void;
}

/** Wraps the matched substring in a Canvas `mark`. */
function highlight(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (needle.length < 2) {
    return text;
  }
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[2px] bg-info-soft px-0.5 text-ink">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  );
}

function monthLabel(date: string): string {
  // "Wed, 28 Oct 2026" → "Oct 2026"
  const parts = formatWallDate(date).split(" ");
  return parts.length >= 4 ? `${parts[2]} ${parts[3]}` : formatWallDate(date);
}

function dayNumber(date: string): string {
  const parts = formatWallDate(date).split(" ");
  return parts.length >= 3 ? (parts[1] ?? "") : "";
}

function rowTime(event: EventView, timezone: string, timeFormat: TimeFormat): string {
  if (event.allDay === 1) {
    return "All day";
  }
  return event.startAt === null ? "" : formatInstant(event.startAt, timezone, timeFormat);
}

export function SearchResultsOverlay({
  id,
  query,
  results,
  isFetching,
  activeIndex,
  timezone,
  timeFormat,
  inline = false,
  onSelect,
  onActiveIndexChange,
}: Props) {
  const { data: calendars } = useCalendars();
  const calendarNames = new Map<string, string>();
  for (const root of calendars ?? []) {
    calendarNames.set(root.id, root.name);
    for (const child of root.children) {
      calendarNames.set(child.id, child.name);
    }
  }

  const trimmed = query.trim();
  const rows = results ?? [];
  const grouped = new Map<string, Array<{ event: EventView; index: number }>>();
  rows.forEach((event, index) => {
    const date = navigableDateFor(event, timezone);
    const key = monthLabel(date);
    const bucket = grouped.get(key) ?? [];
    bucket.push({ event, index });
    grouped.set(key, bucket);
  });

  return (
    <div
      className={cn(
        "rounded-md border border-line-strong bg-surface shadow-menu",
        inline ? "mt-2" : "absolute left-0 top-full z-50 mt-1",
      )}
    >
      <p aria-live="polite" className="sr-only">
        {rows.length > 0 ? `${rows.length} results` : ""}
      </p>

      {trimmed.length < 2 ? (
        <p className="px-4 py-3 text-sm text-ink-soft">
          Search titles, notes and locations.
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-soft">
          {isFetching ? "Searching…" : `No matches for “${trimmed}”`}
        </p>
      ) : (
        <ul
          id={id}
          role="listbox"
          aria-label="Search results"
          className="max-h-[60vh] overflow-y-auto overscroll-contain py-1"
        >
          {[...grouped.entries()].map(([label, bucket]) => (
            <li key={label}>
              <p className="px-4 pt-2 pb-1 text-xs font-bold text-ink-soft">{label}</p>
              <ul>
                {bucket.map(({ event, index }) => {
                  const date = navigableDateFor(event, timezone);
                  const active = index === activeIndex;
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        role="option"
                        id={`${id}-${index}`}
                        aria-selected={active}
                        onClick={() => onSelect(event)}
                        onMouseEnter={() => onActiveIndexChange(index)}
                        className={cn(
                          "flex w-full items-start gap-3 px-3 py-2 text-left",
                          active ? "bg-info-soft" : "hover:bg-well",
                        )}
                      >
                        <span className="w-12 shrink-0 text-center">
                          <span className="block text-xs text-ink-soft">{dayNumber(date)}</span>
                          <span className="block text-sm text-ink">
                            {monthLabel(date).split(" ")[0]}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base text-ink">
                            {highlight(event.title, trimmed)}
                          </span>
                          <span className="block truncate text-xs text-ink-soft">
                            {[
                              rowTime(event, timezone, timeFormat),
                              calendarNames.get(event.calendarId) ?? "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span
                          aria-hidden
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-[2px]"
                          style={{ background: event.color.mainHex }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
