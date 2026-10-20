import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withViewer } from "@/lib/api/route";
import { household, user } from "@/lib/db/schema";
import { listMembers } from "@/lib/services/household";

export const dynamic = "force-dynamic";

export const GET = withViewer(async ({ ctx, db }) => {
  const row = db.select().from(household).where(eq(household.id, ctx.householdId)).get();

  const members = listMembers(db, ctx.householdId).map((membership) => {
    const account = db.select().from(user).where(eq(user.id, membership.userId)).get();
    return {
      id: membership.userId,
      name: account?.name ?? "Member",
      role: membership.role,
      isSelf: membership.userId === ctx.userId,
    };
  });

  return NextResponse.json({
    user: { id: ctx.userId },
    household: row
      ? {
          id: row.id,
          name: row.name,
          timezone: row.timezone,
          weekStartsOn: row.weekStartsOn,
        }
      : null,
    members,
  });
});
