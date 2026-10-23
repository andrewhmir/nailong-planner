import { NextResponse } from "next/server";
import { getSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const sqlite = getSqlite();
    // `getSqlite()` also applies pending migrations and validates the production
    // environment, so a probe of the schema itself proves the deploy is usable —
    // `SELECT 1` alone answered 200 on an empty or half-migrated database.
    sqlite.prepare("SELECT 1").get();
    sqlite.prepare("SELECT COUNT(*) AS n FROM household").get();
    return NextResponse.json({ ok: true, app: "Nailong Planner" });
  } catch (error) {
    console.error("[health] database check failed", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
