import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TasksShell } from "@/components/tasks/TasksShell";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { household as householdTable, member } from "@/lib/db/schema";
import { getPreferences } from "@/lib/services/preferences";

// Every request reads the session cookie; never prerender.
export const dynamic = "force-dynamic";

export default async function TasksPage() {
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
    <div className="mx-auto w-full max-w-3xl">
      <h1>Tasks</h1>
      <TasksShell
        timezone={household?.timezone ?? "Asia/Taipei"}
        // The column is a plain integer; normalise it so the shell (and Task 9's
        // week maths) only ever sees the two supported conventions.
        weekStartsOn={household?.weekStartsOn === 1 ? 1 : 0}
        shortcutsEnabled={getPreferences(db, session.user.id).shortcutsEnabled}
        currentUserId={session.user.id}
      />
    </div>
  );
}
