import { NextResponse } from "next/server";
import type { Database } from "@/lib/db/client";
import { getPreferences, updatePreferences } from "@/lib/services/preferences";
import type { ViewerContext } from "@/lib/services/permissions";
import { updatePreferencesSchema } from "@/lib/validation/preferences";
import { fieldErrors, guarded, readJson } from "./support";

export const getPreferencesHandler = guarded(
  async (db: Database, ctx: ViewerContext): Promise<Response> => {
    return NextResponse.json({ preferences: getPreferences(db, ctx.userId) });
  },
);

export const updatePreferencesHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = updatePreferencesSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const preferences = updatePreferences(db, ctx.userId, parsed.data);
    return NextResponse.json({ preferences });
  },
);
