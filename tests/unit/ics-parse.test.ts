import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIcs } from "@/lib/import/ics";
import { localWallTimeToUtc } from "@/lib/time/zone";

const TAIPEI = "Asia/Taipei";
const LONDON = "Europe/London";
const fixture = (name: string) => readFileSync(`tests/fixtures/ics/${name}`, "utf8");
const at = (wall: string, zone: string) => localWallTimeToUtc(wall, zone);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("parseIcs", () => {
  it("parses a timed Google event, unescapes text and drops alarms", () => {
    const parsed = parseIcs(fixture("google-timed.ics"), TAIPEI);

    expect(parsed.calendars).toEqual([
      expect.objectContaining({ name: "Family", events: 1, recurring: 0, overrides: 0 }),
    ]);
    expect(parsed.events).toHaveLength(1);
    const event = parsed.events[0]!;
    expect(event.title).toBe("Dentist appointment");
    expect(event.description).toBe("Dr. Lin\nBring the insurance card, and the form");
    expect(event.location).toBe("Clinic 4; second floor");
    expect(event.allDay).toBe(false);
    expect(event.tzid).toBe(TAIPEI);
    expect(event.startAt).toBe(at("2026-11-03T09:00", TAIPEI));
    expect(event.endAt).toBe(at("2026-11-03T10:00", TAIPEI));
    expect(event.startDate).toBeNull();
    expect(event.endDate).toBeNull();
    expect(event.externalKey).toBe(sha("ics|dentist-1@google.com|"));
    expect(event.externalKey).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.dropped.alarms).toBe(1);
    expect(parsed.warnings).toEqual([]);
  });

  it("imports a multi-day all-day event without adding a day", () => {
    const event = parseIcs(fixture("google-allday.ics"), TAIPEI).events[0]!;

    expect(event.allDay).toBe(true);
    expect(event.startDate).toBe("2026-11-05");
    // Google writes DTEND exclusive: 20261107 means the break ends on the 6th.
    expect(event.endDate).toBe("2026-11-06");
    expect(event.startAt).toBeNull();
    expect(event.endAt).toBeNull();
  });

  it("parses a recurring series with its rule, timezone and exdates", () => {
    const event = parseIcs(fixture("google-recurring.ics"), TAIPEI).events[0]!;

    expect(event.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(event.tzid).toBe(LONDON);
    expect(event.startAt).toBe(at("2027-03-02T09:00", LONDON));
    expect(event.endAt).toBe(at("2027-03-02T10:30", LONDON));
    expect(event.exdates).toEqual([new Date(at("2027-03-16T09:00", LONDON)).toISOString()]);
  });

  it("materialises a moved occurrence as its own event and excludes the original slot", () => {
    const parsed = parseIcs(fixture("google-overrides.ics"), TAIPEI);

    expect(parsed.events).toHaveLength(2);
    const series = parsed.events.find((event) => event.recurrenceId === null)!;
    const moved = parsed.events.find((event) => event.recurrenceId !== null)!;
    expect(series.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(series.exdates).toEqual([new Date(at("2027-03-09T09:00", LONDON)).toISOString()]);
    expect(moved.title).toBe("Music lesson (moved)");
    expect(moved.rrule).toBeNull();
    expect(moved.startAt).toBe(at("2027-03-09T14:00", LONDON));
    expect(moved.externalKey).toBe(sha("ics|music-1@google.com|" + new Date(at("2027-03-09T09:00", LONDON)).toISOString()));
    expect(moved.externalKey).not.toBe(series.externalKey);
    expect(parsed.calendars[0]?.overrides).toBe(1);
  });

  it("skips an unknown timezone, resolves floating times in the household zone and counts dropped parts", () => {
    const parsed = parseIcs(fixture("google-edge.ics"), TAIPEI);

    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]?.reason).toMatch(/Mars\/Olympus/);
    expect(parsed.warnings[0]?.uid).toBe("unknown-zone@google.com");

    expect(parsed.events.map((event) => event.title)).toEqual([
      "Floating breakfast",
      "Duration only",
      "UTC meeting",
    ]);
    const floating = parsed.events[0]!;
    expect(floating.tzid).toBeNull();
    expect(floating.startAt).toBe(at("2026-12-02T09:00", TAIPEI));

    const duration = parsed.events[1]!;
    expect((duration.endAt ?? 0) - (duration.startAt ?? 0)).toBe(90 * 60 * 1000);

    const utc = parsed.events[2]!;
    expect(utc.tzid).toBeNull();
    expect(utc.startAt).toBe(Date.UTC(2026, 11, 4, 9, 0));

    expect(parsed.dropped.attendees).toBe(1);
    expect(parsed.dropped.attachments).toBe(1);
  });

  it("changes the content hash only when the imported content changes", () => {
    const text = fixture("google-timed.ics");
    const first = parseIcs(text, TAIPEI).events[0]!;
    const second = parseIcs(text, TAIPEI).events[0]!;
    const edited = parseIcs(text.replace("Dentist appointment", "Dentist appointment (new time)"), TAIPEI)
      .events[0]!;

    expect(second.contentHash).toBe(first.contentHash);
    expect(edited.contentHash).not.toBe(first.contentHash);
    expect(edited.externalKey).toBe(first.externalKey);
  });

  it("rejects text that is not an iCalendar document", () => {
    expect(() => parseIcs("hello, this is not a calendar", TAIPEI)).toThrow(/iCalendar/);
  });

  it("shifts a start time inside a spring-forward gap instead of failing the import", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:Family",
      "BEGIN:VEVENT",
      "UID:gap@google.com",
      "SUMMARY:Gap breakfast",
      "DTSTART;TZID=Europe/London:20270328T013000",
      "DTEND;TZID=Europe/London:20270328T023000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const event = parseIcs(text, TAIPEI).events[0]!;
    expect(event.tzid).toBe(LONDON);
    // 01:30 does not exist on 2027-03-28 in London; RFC 5545 shifts it to 02:30 BST.
    expect(event.startAt).toBe(localWallTimeToUtc("2027-03-28T02:30", LONDON));
  });
});
