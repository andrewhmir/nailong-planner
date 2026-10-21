import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { AppError } from "@/lib/errors";
import { addDaysToDate, localWallTimeToUtc, utcToLocalDate } from "@/lib/time/zone";

/**
 * Turns a Google Calendar `.ics` export into the normalised event list the
 * importer upserts. One file is one calendar (Google writes `X-WR-CALNAME`).
 *
 * Rules that keep an import honest (spec R4): unknown `TZID`s skip the event
 * instead of guessing; Google's exclusive all-day `DTEND` becomes an inclusive
 * `endDate`; `RECURRENCE-ID` overrides become standalone rows and exclude the
 * original slot; VALARM/ATTENDEE/ATTACH are counted and dropped.
 */
export interface IcsEvent {
  calendarName: string;
  uid: string;
  /** Date (all-day) or ISO instant of the occurrence this row overrides. */
  recurrenceId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  startAt: number | null;
  endAt: number | null;
  startDate: string | null;
  endDate: string | null;
  /** IANA zone of a timed series; null means UTC or the household zone. */
  tzid: string | null;
  rrule: string | null;
  /** ISO instants for timed series, `YYYY-MM-DD` for all-day series. */
  exdates: string[];
  externalKey: string;
  contentHash: string;
}

export interface IcsWarning {
  uid: string;
  title: string;
  reason: string;
}

export interface IcsCalendarSummary {
  name: string;
  events: number;
  recurring: number;
  overrides: number;
  earliest: string | null;
  latest: string | null;
}

export interface IcsDropped {
  alarms: number;
  attendees: number;
  attachments: number;
}

export interface ParsedIcs {
  calendars: IcsCalendarSummary[];
  events: IcsEvent[];
  warnings: IcsWarning[];
  dropped: IcsDropped;
}

const UTC_ZONES = new Set(["Z", "UTC", "Etc/UTC", "GMT"]);
const DAY_SECONDS = 24 * 60 * 60;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isKnownTimezone(tzid: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

interface TimeParts {
  /** jCal wall time: `YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DD`, optionally `Z`-suffixed. */
  text: string;
  tzid: string | null;
  isDate: boolean;
  isUtc: boolean;
}

type ResolvedTime =
  | { kind: "date"; date: string }
  | { kind: "instant"; instant: number }
  | { kind: "unknown-zone"; zone: string };

function readTime(prop: ICAL.Property | null): TimeParts | null {
  if (!prop) {
    return null;
  }
  const value = prop.getFirstValue() as
    | { toString(): string; isDate?: boolean; zone?: { tzid?: string } }
    | null;
  if (!value) {
    return null;
  }
  const text = value.toString();
  const tzidParam = prop.getParameter("tzid");
  const tzid = typeof tzidParam === "string" && tzidParam.length > 0 ? tzidParam : null;
  return {
    text,
    tzid,
    isDate: value.isDate === true || text.length === 10,
    isUtc: text.endsWith("Z") || UTC_ZONES.has(value.zone?.tzid ?? ""),
  };
}

function resolveTime(
  time: TimeParts | null,
  householdTimezone: string,
): ResolvedTime | null {
  if (!time) {
    return null;
  }
  if (time.isDate) {
    return { kind: "date", date: time.text.slice(0, 10) };
  }
  const wall = time.text.replace(/Z$/, "").slice(0, 16);
  if (time.isUtc) {
    return { kind: "instant", instant: localWallTimeToUtc(wall, "UTC") };
  }
  if (time.tzid) {
    if (!isKnownTimezone(time.tzid)) {
      return { kind: "unknown-zone", zone: time.tzid };
    }
    return { kind: "instant", instant: localWallTimeToUtc(wall, time.tzid) };
  }
  return { kind: "instant", instant: localWallTimeToUtc(wall, householdTimezone) };
}

function textProp(component: ICAL.Component, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function durationMs(value: unknown): number | null {
  const duration = value as { toSeconds?: () => number } | null;
  if (!duration || typeof duration.toSeconds !== "function") {
    return null;
  }
  const seconds = duration.toSeconds();
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

interface Draft {
  uid: string;
  recurrenceId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  startAt: number | null;
  endAt: number | null;
  startDate: string | null;
  endDate: string | null;
  tzid: string | null;
  rrule: string | null;
  exdates: string[];
}

interface DraftResult {
  draft: Draft | null;
  warning: IcsWarning | null;
  dropped: IcsDropped;
}

function emptyDropped(): IcsDropped {
  return { alarms: 0, attendees: 0, attachments: 0 };
}

function addDropped(target: IcsDropped, source: IcsDropped): void {
  target.alarms += source.alarms;
  target.attendees += source.attendees;
  target.attachments += source.attachments;
}

function parseVevent(
  vevent: ICAL.Component,
  calendarName: string,
  householdTimezone: string,
): DraftResult {
  const dropped = emptyDropped();
  dropped.alarms = vevent.getAllSubcomponents("valarm").length;
  dropped.attendees = vevent.getAllProperties("attendee").length;
  dropped.attachments = vevent.getAllProperties("attach").length;

  const uidValue = vevent.getFirstPropertyValue("uid");
  const uid = typeof uidValue === "string" ? uidValue.trim() : "";
  const title = textProp(vevent, "summary") ?? "Untitled event";
  const warning = (reason: string): DraftResult => ({
    draft: null,
    warning: { uid, title, reason },
    dropped,
  });

  if (uid.length === 0) {
    return warning("The event has no UID, so it cannot be imported idempotently.");
  }

  const startProp = vevent.getFirstProperty("dtstart");
  const startTime = readTime(startProp);
  if (!startTime) {
    return warning("The event has no start date.");
  }
  const start = resolveTime(startTime, householdTimezone);
  if (!start) {
    return warning("The event has no start date.");
  }
  if (start.kind === "unknown-zone") {
    return warning(`Unknown timezone ${start.zone}; the event was skipped.`);
  }

  const endProp = vevent.getFirstProperty("dtend");
  const end = resolveTime(readTime(endProp), householdTimezone);
  if (end?.kind === "unknown-zone") {
    return warning(`Unknown timezone ${end.zone}; the event was skipped.`);
  }
  const fallbackDuration = durationMs(vevent.getFirstPropertyValue("duration"));

  const recurrenceIdProp = vevent.getFirstProperty("recurrence-id");
  const recurrenceIdTime = resolveTime(readTime(recurrenceIdProp), householdTimezone);
  if (recurrenceIdTime?.kind === "unknown-zone") {
    return warning(`Unknown timezone ${recurrenceIdTime.zone}; the event was skipped.`);
  }
  const recurrenceId =
    recurrenceIdTime === null
      ? null
      : recurrenceIdTime.kind === "date"
        ? recurrenceIdTime.date
        : new Date(recurrenceIdTime.instant).toISOString();

  const rruleValue = vevent.getFirstPropertyValue("rrule");
  const rrule =
    rruleValue && typeof (rruleValue as { toString?: unknown }).toString === "function"
      ? (rruleValue as { toString(): string }).toString().replace(/^RRULE:/i, "")
      : null;

  const exdates: string[] = [];
  for (const prop of vevent.getAllProperties("exdate")) {
    const values = prop.getValues() as Array<{ toString(): string; isDate?: boolean; zone?: { tzid?: string } }>;
    const tzidParam = prop.getParameter("tzid");
    for (const value of values) {
      const resolved = resolveTime(
        {
          text: value.toString(),
          tzid: typeof tzidParam === "string" && tzidParam.length > 0 ? tzidParam : null,
          isDate: value.isDate === true || value.toString().length === 10,
          isUtc: value.toString().endsWith("Z") || UTC_ZONES.has(value.zone?.tzid ?? ""),
        },
        householdTimezone,
      );
      if (!resolved) {
        continue;
      }
      if (resolved.kind === "unknown-zone") {
        return warning(`Unknown timezone ${resolved.zone} in an exclusion; the event was skipped.`);
      }
      exdates.push(
        resolved.kind === "date" ? resolved.date : new Date(resolved.instant).toISOString(),
      );
    }
  }

  const base = {
    uid,
    recurrenceId,
    title,
    description: textProp(vevent, "description"),
    location: textProp(vevent, "location"),
    rrule,
    exdates,
  };

  if (start.kind === "date") {
    const startDate = start.date;
    let endDate = startDate;
    if (end?.kind === "date") {
      // Google writes DTEND exclusive; storage is inclusive.
      endDate = end.date > startDate ? addDaysToDate(end.date, -1) : startDate;
    } else if (fallbackDuration !== null) {
      const days = Math.max(1, Math.round(fallbackDuration / (DAY_SECONDS * 1000)));
      endDate = addDaysToDate(startDate, days - 1);
    }
    return {
      draft: {
        ...base,
        allDay: true,
        startAt: null,
        endAt: null,
        startDate,
        endDate,
        tzid: null,
      },
      warning: null,
      dropped,
    };
  }

  const startAt = start.instant;
  const endAt =
    end?.kind === "instant" ? end.instant : fallbackDuration !== null ? startAt + fallbackDuration : startAt;
  return {
    draft: {
      ...base,
      allDay: false,
      startAt,
      endAt,
      startDate: null,
      endDate: null,
      tzid: startTime.tzid,
    },
    warning: null,
    dropped,
  };
}

function contentHash(
  event: Omit<IcsEvent, "externalKey" | "contentHash" | "calendarName" | "uid" | "recurrenceId">,
): string {
  return sha256(
    JSON.stringify({
      title: event.title,
      description: event.description,
      location: event.location,
      allDay: event.allDay,
      startAt: event.startAt,
      endAt: event.endAt,
      startDate: event.startDate,
      endDate: event.endDate,
      tzid: event.tzid,
      rrule: event.rrule,
      exdates: event.exdates,
    }),
  );
}

function externalKeyFor(uid: string, recurrenceId: string | null): string {
  return sha256(`ics|${uid}|${recurrenceId ?? ""}`);
}

function toSummary(
  name: string,
  events: IcsEvent[],
  householdTimezone: string,
): IcsCalendarSummary {
  const dates: string[] = [];
  for (const event of events) {
    if (event.allDay && event.startDate) {
      dates.push(event.startDate);
    } else if (event.startAt !== null) {
      dates.push(utcToLocalDate(event.startAt, event.tzid ?? householdTimezone));
    }
  }
  dates.sort();
  return {
    name,
    events: events.length,
    recurring: events.filter((event) => event.rrule !== null).length,
    overrides: events.filter((event) => event.recurrenceId !== null).length,
    earliest: dates[0] ?? null,
    latest: dates.at(-1) ?? null,
  };
}

/** Parses one `.ics` document. Throws only when the text is not iCalendar at all. */
export function parseIcs(
  text: string,
  householdTimezone: string,
  fallbackCalendarName = "Imported calendar",
): ParsedIcs {
  let root: ICAL.Component;
  try {
    const jcal = ICAL.parse(text) as unknown;
    if (!Array.isArray(jcal) || jcal[0] !== "vcalendar") {
      throw new Error("not a vcalendar");
    }
    // ical.js types the constructor awkwardly; this is the library boundary.
    const Component = ICAL.Component as unknown as new (jcal: unknown) => ICAL.Component;
    root = new Component(jcal);
  } catch {
    throw new AppError(
      "VALIDATION",
      "That file is not an iCalendar (.ics) document.",
      400,
    );
  }

  const calname = root.getFirstPropertyValue("x-wr-calname");
  const calendarName =
    typeof calname === "string" && calname.trim().length > 0 ? calname.trim() : fallbackCalendarName;

  const warnings: IcsWarning[] = [];
  const dropped = emptyDropped();
  const drafts: Draft[] = [];

  for (const vevent of root.getAllSubcomponents("vevent")) {
    const { draft, warning, dropped: eventDropped } = parseVevent(
      vevent,
      calendarName,
      householdTimezone,
    );
    addDropped(dropped, eventDropped);
    if (warning) {
      warnings.push(warning);
      continue;
    }
    if (draft) {
      drafts.push(draft);
    }
  }

  // Google exports an override as a second VEVENT with the same UID plus
  // RECURRENCE-ID. Materialise it as its own row and exclude the original slot.
  const byUid = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const group = byUid.get(draft.uid) ?? [];
    group.push(draft);
    byUid.set(draft.uid, group);
  }

  const events: IcsEvent[] = [];
  for (const group of byUid.values()) {
    const base = group.find((draft) => draft.recurrenceId === null) ?? null;
    const overrides = group.filter((draft) => draft.recurrenceId !== null);
    if (base) {
      for (const override of overrides) {
        if (override.recurrenceId && !base.exdates.includes(override.recurrenceId)) {
          base.exdates.push(override.recurrenceId);
        }
      }
    }
    for (const draft of base ? [base, ...overrides] : overrides) {
      const normalised = {
        title: draft.title,
        description: draft.description,
        location: draft.location,
        allDay: draft.allDay,
        startAt: draft.startAt,
        endAt: draft.endAt,
        startDate: draft.startDate,
        endDate: draft.endDate,
        tzid: draft.tzid,
        rrule: draft.rrule,
        exdates: draft.exdates,
      };
      events.push({
        calendarName,
        uid: draft.uid,
        recurrenceId: draft.recurrenceId,
        ...normalised,
        externalKey: externalKeyFor(draft.uid, draft.recurrenceId),
        contentHash: contentHash(normalised),
      });
    }
  }

  return {
    calendars: [toSummary(calendarName, events, householdTimezone)],
    events,
    warnings,
    dropped,
  };
}
