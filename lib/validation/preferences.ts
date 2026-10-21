import { z } from "zod";
import { DEFAULT_VIEWS, TIME_FORMATS } from "@/lib/services/preferences";

export const updatePreferencesSchema = z
  .object({
    defaultView: z.enum(DEFAULT_VIEWS).optional(),
    timeFormat: z.enum(TIME_FORMATS).optional(),
    showWeekNumbers: z.boolean().optional(),
    shortcutsEnabled: z.boolean().optional(),
    lastEventCalendarId: z.string().min(1).nullable().optional(),
  })
  .strict();

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
