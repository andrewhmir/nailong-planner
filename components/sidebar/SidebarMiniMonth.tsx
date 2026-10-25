"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MiniMonth } from "@/components/calendar/MiniMonth";
import { useCollections } from "@/lib/query/collections";
import { useEvents } from "@/lib/query/events";
import { expandOccurrences } from "@/lib/recurrence/expand";
import type { CollectionNode } from "@/lib/services/collections";
import { localWallTimeToUtc, utcToLocalDate } from "@/lib/time/zone";
import { useVisibilityApi } from "@/components/shell/VisibilityProvider";
import { visibleCollectionIds } from "@/lib/ui/visibleCollections";

interface Props {
  currentUserId: string;
  timezone: string;
  /**
   * Task-row drop handler (the sidebar mini month is the month grid that exists
   * on `/tasks`, so it is the practical target for a row drag). Omit it and the
   * grid is navigation-only.
   */
  onTaskDrop?: (taskId: string, date: string) => void;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The household-local bounds of the month an anchor date belongs to. */
function monthRange(anchorDate: string, timezone: string): { from: number; to: number } {
  const [yearText = "1970", monthText = "01"] = anchorDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: localWallTimeToUtc(`${year}-${pad(month)}-01T00:00`, timezone),
    to: localWallTimeToUtc(`${nextYear}-${pad(nextMonth)}-01T00:00`, timezone),
  };
}

/**
 * Sidebar mini calendar: neutral dots for days with visible events, click to
 * navigate via `/?date=`. The grid itself listens for that param. When a task
 * drop handler is supplied it also accepts a dragged task row on a day button;
 * clicking a day still navigates exactly as before.
 */
export function SidebarMiniMonth({ currentUserId, timezone, onTaskDrop }: Props) {
  const router = useRouter();
  const visibility = useVisibilityApi();
  const { data: collections } = useCollections();
  const [anchorDate, setAnchorDate] = useState(() => utcToLocalDate(Date.now(), timezone));

  const range = useMemo(() => monthRange(anchorDate, timezone), [anchorDate, timezone]);
  const { data: events } = useEvents(range);
  const visibleIds = useMemo(
    () => visibleCollectionIds((collections ?? []) as CollectionNode[], visibility.state, currentUserId),
    [collections, visibility.state, currentUserId],
  );

  const eventDates = useMemo(() => {
    const dates = new Set<string>();
    for (const event of events ?? []) {
      if (!visibleIds.has(event.collectionId)) {
        continue;
      }
      for (const occurrence of expandOccurrences(event, range, timezone)) {
        const date =
          event.allDay === 1
            ? occurrence.startKey
            : utcToLocalDate(occurrence.startAt ?? range.from, timezone);
        if (date) {
          dates.add(date);
        }
      }
    }
    return dates;
  }, [events, visibleIds, range, timezone]);

  return (
    <div className="border-b border-line p-3">
      <MiniMonth
        anchorDate={anchorDate}
        eventDates={eventDates}
        onAnchorChange={setAnchorDate}
        onSelectDate={(date) => router.push(`/?date=${date}`)}
        onTaskDrop={onTaskDrop}
      />
    </div>
  );
}
