"use client";

import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { useCalendars } from "@/lib/query/calendars";
import { usePreferences, useUpdatePreferences } from "@/lib/query/preferences";
import { canWriteCalendar } from "@/lib/services/permissions";
import type { UserPreferences } from "@/lib/services/preferences";
import { cn } from "@/lib/utils";

// Canvas card and field recipes, copied from SettingsForm.tsx (the two files
// are not imported from a shared module there, so change them together).
const FIELD =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LABEL = "mb-1 block text-base text-ink";
const CARD = "scroll-mt-6 rounded-md border border-line-strong bg-surface p-6";
const CARD_HEADING = "border-b border-line pb-3 text-2xl font-normal text-ink";

const VIEW_OPTIONS: Array<{ value: UserPreferences["defaultView"]; label: string }> = [
  { value: "auto", label: "Auto (agenda on phone, month on desktop)" },
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
  { value: "listMonth", label: "List" },
];

const TIME_FORMATS: Array<{ value: UserPreferences["timeFormat"]; label: string }> = [
  { value: "24h", label: "24-hour" },
  { value: "12h", label: "12-hour" },
];

interface Props {
  initialPreferences: UserPreferences;
  currentUserId: string;
}

/**
 * Settings → Calendar: the per-user preferences the daily loops read. Every
 * control applies immediately (like the visibility toggles) — there is no Save.
 */
export function CalendarPreferencesCard({ initialPreferences, currentUserId }: Props) {
  const preferences = usePreferences(initialPreferences);
  const update = useUpdatePreferences();
  const { data: calendars } = useCalendars();

  const viewer = { userId: currentUserId, householdId: "" };
  const writableCalendars = (calendars ?? []).flatMap((root) => {
    if (!canWriteCalendar(viewer, root)) {
      return [];
    }
    const entries = [{ id: root.id, name: root.name }];
    for (const child of root.children) {
      // Fold the root's flags in: a protected parent protects its children.
      const effective = {
        ownerId: root.ownerId ?? child.ownerId,
        visibility: root.visibility === "shared" ? child.visibility : root.visibility,
      };
      if (canWriteCalendar(viewer, effective)) {
        entries.push({ id: child.id, name: `${root.name} / ${child.name}` });
      }
    }
    return entries;
  });

  function save(patch: Partial<UserPreferences>) {
    update.mutate(patch, {
      onSuccess: () => toast.success("Preferences updated"),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <section id="calendar" className={CARD}>
      <h2 className={CARD_HEADING}>Calendar</h2>
      <div className="mt-6 grid gap-6">
        <div>
          <span id="time-format-label" className={LABEL}>
            Time format
          </span>
          <div
            role="group"
            aria-labelledby="time-format-label"
            className="inline-flex overflow-hidden rounded-md border border-line-strong bg-surface"
          >
            {TIME_FORMATS.map((option, index) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={preferences.timeFormat === option.value}
                onClick={() => save({ timeFormat: option.value })}
                className={cn(
                  "h-[38px] px-4 text-base transition-colors",
                  index > 0 && "border-l border-line-strong",
                  preferences.timeFormat === option.value
                    ? "bg-accent text-white"
                    : "text-ink hover:bg-well",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={LABEL} htmlFor="default-view">
            Default view
          </label>
          <select
            id="default-view"
            value={preferences.defaultView}
            onChange={(event) =>
              save({ defaultView: event.target.value as UserPreferences["defaultView"] })
            }
            className={FIELD}
          >
            {VIEW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            label="Week numbers"
            checked={preferences.showWeekNumbers}
            onCheckedChange={(checked) => save({ showWeekNumbers: checked })}
            className="mt-1"
          />
          <div>
            <span className="text-base text-ink">Week numbers</span>
            <p className="text-sm text-ink-soft">Show the week number in the month grid.</p>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            label="Keyboard shortcuts"
            checked={preferences.shortcutsEnabled}
            onCheckedChange={(checked) => save({ shortcutsEnabled: checked })}
            className="mt-1"
          />
          <div>
            <span className="text-base text-ink">Keyboard shortcuts</span>
            <p className="text-sm text-ink-soft">
              Single-key shortcuts can be turned off here.
            </p>
          </div>
        </div>

        <div>
          <label className={LABEL} htmlFor="default-event-calendar">
            Default event calendar
          </label>
          <select
            id="default-event-calendar"
            value={preferences.lastEventCalendarId ?? ""}
            onChange={(event) =>
              save({
                lastEventCalendarId: event.target.value === "" ? null : event.target.value,
              })
            }
            className={FIELD}
          >
            <option value="">None</option>
            {writableCalendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
