import { z } from "zod";

export const updateHouseholdSchema = z.object({
  name: z.string().trim().min(1, "Give the household a name.").max(60).optional(),
  timezone: z.string().min(1).max(64).optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Give yourself a name.").max(60),
});

export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
