import { z } from "zod";
import { HUE_FAMILIES } from "@/lib/color/palette";

/** A node of the two-level tree: a calendar holds events, a list holds tasks. */
export const collectionKindSchema = z.enum(["calendar", "list"]);
export const collectionVisibilitySchema = z.enum(["shared", "view_only", "private"]);

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1, "Give the calendar a name.").max(60, "Keep names under 60 characters."),
  parentId: z.string().min(1).nullish(),
  kind: collectionKindSchema.optional(),
  hueFamily: z.enum(HUE_FAMILIES).nullish(),
  ownerId: z.string().min(1).nullish(),
  visibility: collectionVisibilitySchema.optional(),
});

export const updateCollectionSchema = z.object({
  name: z.string().trim().min(1, "Give the calendar a name.").max(60, "Keep names under 60 characters.").optional(),
  hueFamily: z.enum(HUE_FAMILIES).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  visibility: collectionVisibilitySchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
