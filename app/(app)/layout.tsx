import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Providers } from "@/app/providers";
import { AppShell, type MemberSummary } from "@/components/shell/AppShell";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { household as householdTable, member, user as userTable } from "@/lib/db/schema";
import { listMembers } from "@/lib/services/household";

// Every page here depends on the session cookie; never prerender.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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

  const householdRow = db
    .select()
    .from(householdTable)
    .where(eq(householdTable.id, membership.householdId))
    .get();

  const members: MemberSummary[] = listMembers(db, membership.householdId).map((entry) => {
    const account = db.select().from(userTable).where(eq(userTable.id, entry.userId)).get();
    return {
      id: entry.userId,
      name: account?.name ?? "Member",
      isSelf: entry.userId === session.user.id,
    };
  });

  const currentUser = members.find((entry) => entry.isSelf) ?? {
    id: session.user.id,
    name: session.user.name,
    isSelf: true,
  };

  return (
    <Providers>
      <AppShell
        currentUser={{ id: currentUser.id, name: currentUser.name }}
        members={members}
        householdName={householdRow?.name ?? "Our Nest"}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
