import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { household as householdTable, member } from "@/lib/db/schema";
import { getPreferences } from "@/lib/services/preferences";

export default async function SettingsPage() {
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
    <div className="mx-auto max-w-5xl">
      {/* Below md the rail is a phone top bar with no link home, so this page
          has to carry its own way back. The rail owns it at md and up. */}
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1 text-sm text-link hover:underline md:hidden"
      >
        <ChevronLeftIcon size={16} />
        Back to calendar
      </Link>
      <h1>Settings</h1>
      <SettingsForm
        initialName={session.user.name}
        initialHousehold={{
          name: household?.name ?? "Our Nest",
          timezone: household?.timezone ?? "Asia/Taipei",
          weekStartsOn: household?.weekStartsOn ?? 0,
        }}
        initialPreferences={getPreferences(db, session.user.id)}
        currentUserId={session.user.id}
        currentUserEmail={session.user.email}
      />
    </div>
  );
}
