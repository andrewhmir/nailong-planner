import { z } from "zod";
import { HUE_FAMILIES } from "@/lib/color/palette";

export const createCalendarSchema = z.object({
  name: z.string().trim().min(1, "Give the calendar a name.").max(60, "Keep names under 60 characters."),
  parentId: z.string().min(1).nullish(),
  hueFamily: z.enum(HUE_FAMILIES).nullish(),
  ownerId: z.string().min(1).nullish(),
  isViewOnlyForPartner: z.boolean().optional(),
});

export const updateCalendarSchema = z.object({
  name: z.string().trim().min(1, "Give the calendar a name.").max(60, "Keep names under 60 characters.").optional(),
  hueFamily: z.enum(HUE_FAMILIES).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  isViewOnlyForPartner: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;
