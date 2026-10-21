import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportWizard } from "@/components/import/ImportWizard";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { member } from "@/lib/db/schema";

export default async function ImportPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const membership = getDb()
    .select()
    .from(member)
    .where(eq(member.userId, session.user.id))
    .get();
  if (!membership) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/settings"
        className="mb-3 inline-flex items-center gap-1 text-sm text-link hover:underline"
      >
        <ChevronLeftIcon size={16} />
        Back to settings
      </Link>
      <h1>Import from Google Calendar</h1>
      <ImportWizard currentUserId={session.user.id} />
    </div>
  );
}
