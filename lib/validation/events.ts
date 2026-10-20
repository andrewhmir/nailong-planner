import { z } from "zod";
import { AppError } from "@/lib/errors";
import { toAllDayRange } from "@/lib/time/zone";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const eventBaseFields = {
  title: z.string().trim().min(1, "Give the event a title.").max(200),
  description: z.string().max(4000).nullish(),
  location: z.string().max(200).nullish(),
  allDay: z.boolean(),
  startAt: z.number().int().nullish(),
  endAt: z.number().int().nullish(),
  startDate: dateString.nullish(),
  endDate: dateString.nullish(),
  rrule: z.string().max(500).nullish(),
  exdates: z.array(z.string().min(1)).nullish(),
};

/**
 * `allDay` defaults only on create. The update schema must NOT carry that
 * default, otherwise a partial PATCH of an all-day event would look like a
 * conversion to a timed event.
 */
export const createEventSchema = z.object({
  calendarId: z.string().min(1),
  ...eventBaseFields,
  allDay: z.boolean().default(false),
});

export const updateEventSchema = z
  .object({
    calendarId: z.string().min(1).optional(),
    ...eventBaseFields,
  })
  .partial();

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export interface EventShapeInput {
  allDay?: boolean;
  startAt?: number | null;
  endAt?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month ?? 1) - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * The all-day invariant: all-day events carry local dates and no instants;
 * timed events carry instants and no dates.
 */
export function assertEventShape(input: EventShapeInput): void {
  const allDay = input.allDay ?? false;

  if (allDay) {
    if (!input.startDate || !input.endDate) {
      throw new AppError("VALIDATION", "All-day events need a start and end date.", 400, {
        startDate: "Choose a date.",
      });
    }
    if (!isRealDate(input.startDate) || !isRealDate(input.endDate)) {
      throw new AppError("VALIDATION", "That calendar date does not exist.", 400, {
        startDate: "Choose a real date.",
      });
    }
    const range = toAllDayRange(input.startDate, input.endDate);
    void range;
    if (input.startAt != null || input.endAt != null) {
      throw new AppError("VALIDATION", "All-day events cannot have times.", 400, {
        startAt: "Remove the time.",
      });
    }
    return;
  }

  if (input.startAt == null || input.endAt == null) {
    throw new AppError("VALIDATION", "Timed events need a start and end time.", 400, {
      startAt: "Choose a time.",
    });
  }
  if (input.startDate != null || input.endDate != null) {
    throw new AppError("VALIDATION", "Timed events cannot have all-day dates.", 400, {
      startDate: "Remove the date.",
    });
  }
  if (input.endAt <= input.startAt) {
    throw new AppError("VALIDATION", "The end time must be after the start time.", 400, {
      endAt: "Choose a later time.",
    });
  }
}
