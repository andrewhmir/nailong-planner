import { NextResponse } from "next/server";
import type { Database } from "@/lib/db/client";
import { updateHousehold, updateMemberName } from "@/lib/services/household";
import type { ViewerContext } from "@/lib/services/permissions";
import { updateHouseholdSchema, updateProfileSchema } from "@/lib/validation/settings";
import { fieldErrors, guarded, readJson } from "./support";

export const updateHouseholdHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = updateHouseholdSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const household = updateHousehold(db, ctx, parsed.data);
    return NextResponse.json({ household });
  },
);

export const updateProfileHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = updateProfileSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const user = updateMemberName(db, ctx, parsed.data.name);
    return NextResponse.json({ user });
  },
);
