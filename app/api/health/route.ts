import { NextResponse } from "next/server";
import { getSqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    getSqlite().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true, app: "Nailong Planner" });
  } catch (error) {
    console.error("[health] database check failed", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
