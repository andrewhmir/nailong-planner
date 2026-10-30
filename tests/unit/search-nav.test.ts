import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/db/schema";
import { navigableDateFor } from "@/lib/query/search";
import type { EventView } from "@/lib/services/events";
import { localWallTimeToUtc } from "@/lib/time/zone";

const TAIPEI = "Asia/Taipei";
const at = (wall: string) => localWallTimeToUtc(wall, TAIPEI);

function view(overrides: Partial<EventRow> = {}): EventView {
  const base: EventView = {
    id: "e1",
    householdId: "h1",
    collectionId: "c1",
    title: "Daily standup",
    description: null,
    location: null,
    allDay: 0,
    startAt: at("2026-10-01T09:00"),
    endAt: at("2026-10-01T10:00"),
    startDate: null,
    endDate: null,
    rrule: "FREQ=DAILY",
    exdates: null,
    recurrenceParentId: null,
    recurrenceId: null,
    tzid: null,
    externalSource: null,
    externalUid: null,
    externalRecurrenceId: null,
    externalKey: null,
    externalContentHash: null,
    createdBy: "u1",
    createdAt: 0,
    updatedAt: 0,
    color: {
      main: "#000000",
      mainHex: "#000000",
      container: "#ffffff",
      containerHex: "#ffffff",
      onContainer: "#000000",
    },
  };
  return { ...base, ...overrides };
}

function setNow(wall: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at(wall)));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("navigableDateFor", () => {
  it("opens a timed series at its next occurrence, not the one that started yesterday", () => {
    setNow("2026-10-30T10:00");
    expect(navigableDateFor(view(), TAIPEI)).toBe("2026-10-31");
  });

  it("opens today's timed occurrence while it is still ahead", () => {
    setNow("2026-10-30T08:00");
    expect(navigableDateFor(view(), TAIPEI)).toBe("2026-10-30");
  });

  it("opens an all-day series at today, not yesterday's block", () => {
    setNow("2026-10-30T00:30");
    expect(
      navigableDateFor(
        view({
          allDay: 1,
          startAt: null,
          endAt: null,
          startDate: "2026-10-01",
          endDate: "2026-10-01",
        }),
        TAIPEI,
      ),
    ).toBe("2026-10-30");
  });
});
