import { and, eq, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Database } from "@/lib/db/client";
import { event, type EventRow } from "@/lib/db/schema";
import { toView } from "./events";
import type { ViewerContext } from "./permissions";
import type { EventView } from "./events";

/**
 * Household-wide event search (spec D8). SQLite LIKE is ASCII-case-insensitive,
 * so no lower() is needed for the common case; the wildcard characters in the
 * user's query are escaped so "100%" cannot match everything.
 */

const MIN_QUERY_LENGTH = 2;
const CANDIDATE_LIMIT = 200;
const RESULT_LIMIT = 50;

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function rank(row: EventRow, needle: string): number {
  const title = row.title.toLowerCase();
  if (title === needle) {
    return 0;
  }
  if (title.startsWith(needle)) {
    return 1;
  }
  if (title.includes(needle)) {
    return 2;
  }
  if ((row.location ?? "").toLowerCase().includes(needle)) {
    return 3;
  }
  if ((row.description ?? "").toLowerCase().includes(needle)) {
    return 4;
  }
  return 5;
}

export function searchEvents(
  db: Database,
  ctx: ViewerContext,
  rawQuery: string,
  limit: number = RESULT_LIMIT,
): EventView[] {
  const term = rawQuery.trim();
  if (term.length < MIN_QUERY_LENGTH) {
    return [];
  }

  const pattern = `%${escapeLike(term)}%`;
  const matches = (column: AnySQLiteColumn) =>
    sql`${column} LIKE ${pattern} ESCAPE '\\'`;

  const rows = db
    .select()
    .from(event)
    .where(
      and(
        eq(event.householdId, ctx.householdId),
        or(matches(event.title), matches(event.location), matches(event.description)),
      ),
    )
    .limit(CANDIDATE_LIMIT)
    .all();

  const needle = term.toLowerCase();
  const sorted = rows.sort(
    (left, right) =>
      rank(left, needle) - rank(right, needle) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );

  const cap = Math.max(1, Math.min(Math.trunc(limit) || RESULT_LIMIT, RESULT_LIMIT));
  // One row per stored event: recurring series are expanded on the client, not
  // here, so a series is never one hit per occurrence.
  return sorted.slice(0, cap).map((row) => toView(db, row));
}
