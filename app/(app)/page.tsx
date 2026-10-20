import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CalendarShell } from "@/components/calendar/CalendarShell";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { household as householdTable, member } from "@/lib/db/schema";

export default async function CalendarPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const db = getDb();
  const membership = db
    .select()
    .from(member)
    .where(eq(member.userId, session.user.id))
    .get();

  if (!membership) {
    redirect("/login");
  }

  const household = db
    .select()
    .from(householdTable)
    .where(eq(householdTable.id, membership.householdId))
    .get();

  return (
    <CalendarShell
      timezone={household?.timezone ?? "Asia/Taipei"}
      currentUserId={session.user.id}
      weekStartsOn={household?.weekStartsOn ?? 0}
    />
  );
}
