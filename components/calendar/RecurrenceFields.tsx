"use client";

import { Button } from "@/components/ui/button";
import { describeRrule } from "@/lib/recurrence/label";
import {
  clampInt,
  dayOfMonthOf,
  formatRepeatRule,
  monthlyAnchor,
  weekdayOfDate,
  weekdayOrder,
  type RepeatOptions,
} from "@/lib/recurrence/rule";
import { DateField } from "./DateField";

/**
 * Google Calendar's "Custom recurrence" panel, rendered inline under the
 * Repeat select instead of in a nested dialog: interval, weekly day picker,
 * monthly day/nth-weekday pattern and Never / On / After ends. Controlled and
 * pure — `EventDialog` owns the state and the rule preservation logic.
 */

const CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink transition-colors duration-150 hover:border-ink-soft focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const NARROW = `${CONTROL} w-[74px]`;
const LABEL = "block text-base text-ink";
const HINT = "text-sm text-ink-soft";
const RADIO = "h-4 w-4 accent-accent";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

const ORDINAL_VALUES = [1, 2, 3, 4, 5, -1] as const;

const ORDINAL_LABELS: Record<string, string> = {
  "1": "first",
  "2": "second",
  "3": "third",
  "4": "fourth",
  "5": "fifth",
  "-1": "last",
};

const UNIT_BY_FREQUENCY: Record<RepeatOptions["frequency"], string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

interface Props {
  value: RepeatOptions;
  /** The event's start date; used as the anchor for defaults and previews. */
  startDate: string;
  allDay: boolean;
  timezone: string;
  weekStartsOn: number;
  /** Household-local today, forwarded to the end-date picker. */
  today: string;
  /** Inline validation message; Save is blocked while this is set. */
  error: string | null;
  onChange: (next: RepeatOptions) => void;
}

export function RecurrenceFields({
  value,
  startDate,
  allDay,
  timezone,
  weekStartsOn,
  today,
  error,
  onChange,
}: Props) {
  const context = { allDay, timezone };
  const preview = describeRrule(formatRepeatRule(value, startDate, context), context);
  const unit = UNIT_BY_FREQUENCY[value.frequency];
  const unitLabel = value.interval === 1 ? `${unit}` : `${unit}s`;

  function toggleWeekday(day: number): void {
    const selected = value.weekdays.includes(day);
    // Google keeps at least one day checked; refusing the last uncheck avoids
    // an invalid weekly rule the user cannot see.
    if (selected && value.weekdays.length === 1) {
      return;
    }
    const weekdays = selected
      ? value.weekdays.filter((candidate) => candidate !== day)
      : [...value.weekdays, day];
    onChange({ ...value, weekdays });
  }

  function selectMonthlyMode(mode: "dayOfMonth" | "weekday"): void {
    if (mode === value.monthly.mode) {
      return;
    }
    onChange({
      ...value,
      monthly:
        mode === "dayOfMonth"
          ? { mode: "dayOfMonth", day: dayOfMonthOf(startDate) }
          : monthlyAnchor(startDate),
    });
  }

  return (
    <fieldset className="space-y-3 rounded-lg border border-line px-3 pb-3 pt-2">
      <legend className="px-1 text-sm text-ink-soft">Custom recurrence</legend>

      <div className="flex items-center gap-2">
        <label htmlFor="repeat-interval" className={`${LABEL} shrink-0`}>
          Repeat every
        </label>
        <input
          id="repeat-interval"
          type="number"
          min={1}
          max={99}
          inputMode="numeric"
          value={value.interval}
          onChange={(event) =>
            onChange({ ...value, interval: clampInt(Number(event.target.value), 1, 99) })
          }
          className={NARROW}
        />
        <span className={HINT}>{unitLabel}</span>
      </div>

      {value.frequency === "WEEKLY" ? (
        <div className="space-y-1">
          <p className={LABEL} id="repeat-weekday-label">
            Repeat on
          </p>
          <div
            role="group"
            aria-labelledby="repeat-weekday-label"
            className="flex flex-wrap gap-1.5"
          >
            {weekdayOrder(weekStartsOn).map((day) => {
              const pressed = value.weekdays.includes(day);
              return (
                <Button
                  key={day}
                  size="sm"
                  variant={pressed ? "primary" : "outline"}
                  aria-pressed={pressed}
                  aria-label={WEEKDAY_NAMES[day]}
                  className="w-9"
                  onClick={() => toggleWeekday(day)}
                >
                  {WEEKDAY_LETTERS[day]}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {value.frequency === "MONTHLY" ? (
        <div className="space-y-2">
          <p className={LABEL}>Monthly</p>
          <label className="flex items-center gap-2 text-base text-ink">
            <input
              type="radio"
              name="repeat-monthly"
              checked={value.monthly.mode === "weekday"}
              onChange={() => selectMonthlyMode("weekday")}
              className={RADIO}
            />
            <span>On the</span>
            <select
              aria-label="Which week of the month"
              value={String(value.monthly.mode === "weekday" ? value.monthly.ordinal : 1)}
              onChange={(event) =>
                onChange({
                  ...value,
                  monthly: {
                    mode: "weekday",
                    ordinal: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | -1,
                    weekday:
                      value.monthly.mode === "weekday"
                        ? value.monthly.weekday
                        : weekdayOfDate(startDate),
                  },
                })
              }
              className={`${CONTROL} w-[110px]`}
            >
              {ORDINAL_VALUES.map((ordinal) => (
                <option key={ordinal} value={String(ordinal)}>
                  {ORDINAL_LABELS[String(ordinal)]}
                </option>
              ))}
            </select>
            <select
              aria-label="Weekday"
              value={String(
                value.monthly.mode === "weekday" ? value.monthly.weekday : weekdayOfDate(startDate),
              )}
              onChange={(event) =>
                onChange({
                  ...value,
                  monthly: {
                    mode: "weekday",
                    ordinal: value.monthly.mode === "weekday" ? value.monthly.ordinal : 1,
                    weekday: Number(event.target.value),
                  },
                })
              }
              className={`${CONTROL} w-[120px]`}
            >
              {WEEKDAY_NAMES.map((name, day) => (
                <option key={name} value={String(day)}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-base text-ink">
            <input
              type="radio"
              name="repeat-monthly"
              checked={value.monthly.mode === "dayOfMonth"}
              onChange={() => selectMonthlyMode("dayOfMonth")}
              className={RADIO}
            />
            <span>On day</span>
            <input
              aria-label="Day of the month"
              type="number"
              min={1}
              max={31}
              inputMode="numeric"
              value={value.monthly.mode === "dayOfMonth" ? value.monthly.day : dayOfMonthOf(startDate)}
              onChange={(event) =>
                onChange({
                  ...value,
                  monthly: { mode: "dayOfMonth", day: clampInt(Number(event.target.value), 1, 31) },
                })
              }
              className={NARROW}
            />
          </label>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className={LABEL}>Ends</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-base text-ink">
            <input
              type="radio"
              name="repeat-end"
              checked={value.end.mode === "never"}
              onChange={() => onChange({ ...value, end: { mode: "never" } })}
              className={RADIO}
            />
            Never
          </label>
          <div className="flex items-center gap-2">
            <input
              id="repeat-end-on"
              type="radio"
              name="repeat-end"
              checked={value.end.mode === "on"}
              onChange={() =>
                onChange({
                  ...value,
                  end: { mode: "on", date: value.end.mode === "on" ? value.end.date : startDate },
                })
              }
              className={RADIO}
            />
            <label htmlFor="repeat-end-on" className="text-base text-ink">
              On
            </label>
            {value.end.mode === "on" ? (
              <div className="w-[170px]">
                <DateField
                  id="repeat-end-date"
                  label="Repeat ends"
                  value={value.end.date}
                  today={today}
                  onChange={(date) => onChange({ ...value, end: { mode: "on", date } })}
                />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="repeat-end-after"
              type="radio"
              name="repeat-end"
              checked={value.end.mode === "after"}
              onChange={() =>
                onChange({
                  ...value,
                  end: { mode: "after", count: value.end.mode === "after" ? value.end.count : 10 },
                })
              }
              className={RADIO}
            />
            <label htmlFor="repeat-end-after" className="text-base text-ink">
              After
            </label>
            {value.end.mode === "after" ? (
              <>
                <input
                  aria-label="Number of occurrences"
                  type="number"
                  min={1}
                  max={730}
                  inputMode="numeric"
                  value={value.end.count}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      end: { mode: "after", count: clampInt(Number(event.target.value), 1, 730) },
                    })
                  }
                  className={NARROW}
                />
                <span className={HINT}>occurrences</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {value.advanced ? (
        <p className={HINT}>
          This series carries extra repeat details (for example from an import). Changing these
          controls replaces them with the rule shown below.
        </p>
      ) : null}

      <p className="text-sm text-ink-soft" aria-live="polite">
        {preview}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
