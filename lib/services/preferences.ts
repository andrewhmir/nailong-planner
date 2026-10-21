import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { userPreference } from "@/lib/db/schema";

/**
 * Per-user calendar preferences (spec D2/D3). One lazy row per user: a missing
 * row means "all defaults", so reads never write.
 */
export const DEFAULT_VIEWS = [
  "auto",
  "dayGridMonth",
  "timeGridWeek",
  "timeGridDay",
  "listMonth",
] as const;
export type DefaultView = (typeof DEFAULT_VIEWS)[number];

export const TIME_FORMATS = ["12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export interface UserPreferences {
  /** `auto` resolves to agenda on phones and month on larger screens. */
  defaultView: DefaultView;
  timeFormat: TimeFormat;
  showWeekNumbers: boolean;
  shortcutsEnabled: boolean;
  /** Calendar id preselected in the event editor; null means "pick for me". */
  lastEventCalendarId: string | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  defaultView: "auto",
  timeFormat: "24h",
  showWeekNumbers: false,
  shortcutsEnabled: true,
  lastEventCalendarId: null,
};

function isDefaultView(value: string): value is DefaultView {
  return (DEFAULT_VIEWS as readonly string[]).includes(value);
}

function isTimeFormat(value: string): value is TimeFormat {
  return (TIME_FORMATS as readonly string[]).includes(value);
}

/** Stored enum values from an older build fall back to the defaults. */
function normalise(row: {
  defaultView: string;
  timeFormat: string;
  showWeekNumbers: number;
  shortcutsEnabled: number;
  lastEventCalendarId: string | null;
}): UserPreferences {
  return {
    defaultView: isDefaultView(row.defaultView) ? row.defaultView : DEFAULT_PREFERENCES.defaultView,
    timeFormat: isTimeFormat(row.timeFormat) ? row.timeFormat : DEFAULT_PREFERENCES.timeFormat,
    showWeekNumbers: row.showWeekNumbers === 1,
    shortcutsEnabled: row.shortcutsEnabled === 1,
    lastEventCalendarId: row.lastEventCalendarId ?? null,
  };
}

export function getPreferences(db: Database, userId: string): UserPreferences {
  const row = db.select().from(userPreference).where(eq(userPreference.userId, userId)).get();
  return row ? normalise(row) : { ...DEFAULT_PREFERENCES };
}

export function updatePreferences(
  db: Database,
  userId: string,
  patch: Partial<UserPreferences>,
): UserPreferences {
  const current = getPreferences(db, userId);
  const merged: UserPreferences = {
    defaultView: patch.defaultView ?? current.defaultView,
    timeFormat: patch.timeFormat ?? current.timeFormat,
    showWeekNumbers: patch.showWeekNumbers ?? current.showWeekNumbers,
    shortcutsEnabled: patch.shortcutsEnabled ?? current.shortcutsEnabled,
    lastEventCalendarId:
      patch.lastEventCalendarId === undefined
        ? current.lastEventCalendarId
        : patch.lastEventCalendarId,
  };

  const updatedAt = Date.now();
  const values = {
    userId,
    defaultView: merged.defaultView,
    timeFormat: merged.timeFormat,
    showWeekNumbers: merged.showWeekNumbers ? 1 : 0,
    shortcutsEnabled: merged.shortcutsEnabled ? 1 : 0,
    lastEventCalendarId: merged.lastEventCalendarId,
    updatedAt,
  };

  db.insert(userPreference)
    .values(values)
    .onConflictDoUpdate({ target: userPreference.userId, set: values })
    .run();

  return merged;
}
