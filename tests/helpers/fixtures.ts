import { household, member } from "@/lib/db/schema";
import { makeTestDb, type TestDb } from "./db";
import type { ViewerContext } from "@/lib/services/permissions";

export interface SeededDb extends TestDb {
  ctxA: ViewerContext;
  ctxB: ViewerContext;
  ctxOther: ViewerContext;
}

/**
 * A migrated database with one household ("h1") containing two members and a
 * second household ("h2") used to prove tenant isolation.
 */
export async function makeSeededDb(): Promise<SeededDb> {
  const testDb = await makeTestDb();

  testDb.db.insert(household).values({ id: "h1", name: "Our Nest" }).run();
  testDb.db.insert(household).values({ id: "h2", name: "Other Nest" }).run();

  testDb.db.insert(member).values({ userId: "user-a", householdId: "h1", role: "owner" }).run();
  testDb.db.insert(member).values({ userId: "user-b", householdId: "h1", role: "owner" }).run();
  testDb.db.insert(member).values({ userId: "user-c", householdId: "h2", role: "owner" }).run();

  return {
    ...testDb,
    ctxA: { userId: "user-a", householdId: "h1" },
    ctxB: { userId: "user-b", householdId: "h1" },
    ctxOther: { userId: "user-c", householdId: "h2" },
  };
}
