import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/Brand";
import { getAuth } from "@/lib/auth/server";
import { LoginForm } from "./LoginForm";

// Session checks require the request context; never prerender.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) {
    redirect("/");
  }

  return (
    <main className="safe-x-4 flex min-h-dvh flex-col items-center justify-center gap-6 bg-rail pt-[calc(3rem_+_var(--safe-top))] pb-[calc(3rem_+_var(--safe-bottom))]">
      <Brand name="Nailong Planner" />

      <div className="w-full max-w-[400px] rounded-md bg-surface p-8 shadow-dialog">
        <h1 className="text-2xl font-normal text-ink">Nailong Planner</h1>
        <p className="mt-1 text-sm text-ink-soft">A private planner for two.</p>
        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
