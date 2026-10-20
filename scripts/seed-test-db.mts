import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv } from "./load-env.mts";

loadEnv();

// The E2E database is always a scratch file with a fixed origin/secret.
process.env.DATABASE_URL = "file:./.playwright/test.db";
process.env.BETTER_AUTH_URL = "http://localhost:3100";
process.env.BETTER_AUTH_SECRET = "playwright-test-secret-0123456789abcdef";
process.env.TZ = "Asia/Taipei";

const { env } = await import("../lib/env");
const { createDb } = await import("../lib/db/client");
const { migrate } = await import("../lib/db/migrate");
const { createAuth } = await import("../lib/auth/server");
const { ensureHousehold, addMember } = await import("../lib/services/household");
const { createCalendar, updateCalendar } = await import("../lib/services/calendars");
const { createEvent } = await import("../lib/services/events");
const { localWallTimeToUtc } = await import("../lib/time/zone");
const schema = await import("../lib/db/schema");

const USERS = [
  { key: "andrew", name: "Andrew", email: "andrew@example.test" },
  { key: "partner", name: "Partner", email: "partner@example.test" },
] as const;
const PASSWORD = "test-password-1234";

async function main(): Promise<void> {
  mkdirSync(".playwright", { recursive: true });

  const { db, sqlite } = createDb(env.DATABASE_URL);
  migrate(db);

  // Clear the previous run's rows instead of deleting the file: a dev server may
  // still hold the SQLite handle, and truncating keeps the run deterministic.
  for (const table of [
    schema.event,
    schema.calendar,
    schema.member,
    schema.twoFactor,
    schema.session,
    schema.account,
    schema.verification,
    schema.household,
    schema.user,
  ]) {
    db.delete(table).run();
  }

  const auth = createAuth(db, { allowSignUp: true, rateLimit: false });
  const household = ensureHousehold(db, "Our Nest");

  const userIds: Record<string, string> = {};
  for (const user of USERS) {
    const result = await auth.api.signUpEmail({
      body: { name: user.name, email: user.email, password: PASSWORD },
    });
    userIds[user.key] = result.user.id;
    addMember(db, result.user.id, household.id);
  }

  const andrew = { userId: userIds.andrew!, householdId: household.id };
  const partner = { userId: userIds.partner!, householdId: household.id };

  // Ours
  const householdCalendar = createCalendar(db, andrew, { name: "Household", hueFamily: "teal" });
  const chores = createCalendar(db, andrew, { name: "Chores", parentId: householdCalendar.id });
  const trips = createCalendar(db, andrew, { name: "Trips", parentId: householdCalendar.id });

  // Mine
  const school = createCalendar(db, andrew, { name: "School", hueFamily: "indigo", ownerId: andrew.userId });
  const math = createCalendar(db, andrew, { name: "Math", parentId: school.id });
  const biology = createCalendar(db, andrew, { name: "Biology", parentId: school.id });
  const work = createCalendar(db, andrew, { name: "Work", hueFamily: "amber", ownerId: andrew.userId });
  const onCall = createCalendar(db, andrew, { name: "On-call", parentId: work.id });
  // View-only lives on the root and cascades to its sub-calendars.
  updateCalendar(db, andrew, work.id, { isViewOnlyForPartner: true });

  // Hers
  const health = createCalendar(db, partner, { name: "Health", hueFamily: "rose", ownerId: partner.userId });
  createCalendar(db, partner, { name: "Gym", parentId: health.id });

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const dayMid = `${year}-${month}-15`;
  const dayLater = `${year}-${month}-20`;

  const mathQuiz = createEvent(db, andrew, {
    calendarId: math.id,
    title: "Math quiz",
    allDay: false,
    startAt: localWallTimeToUtc(`${dayLater}T09:00`, household.timezone),
    endAt: localWallTimeToUtc(`${dayLater}T10:00`, household.timezone),
  });
  const trip = createEvent(db, andrew, {
    calendarId: householdCalendar.id,
    title: "Kyoto trip",
    allDay: true,
    startDate: dayMid,
    endDate: dayMid,
  });
  const weeklyClass = createEvent(db, andrew, {
    calendarId: school.id,
    title: "Weekly class",
    allDay: false,
    startAt: localWallTimeToUtc(`${dayMid}T13:00`, household.timezone),
    endAt: localWallTimeToUtc(`${dayMid}T14:00`, household.timezone),
    rrule: "FREQ=WEEKLY;BYDAY=TU",
  });
  const onCallShift = createEvent(db, andrew, {
    calendarId: onCall.id,
    title: "On-call shift",
    allDay: false,
    startAt: localWallTimeToUtc(`${dayMid}T18:00`, household.timezone),
    endAt: localWallTimeToUtc(`${dayMid}T20:00`, household.timezone),
  });

  const fixtures = {
    householdId: household.id,
    password: PASSWORD,
    users: { andrew: andrew.userId, partner: partner.userId },
    calendars: {
      household: householdCalendar.id,
      chores: chores.id,
      trips: trips.id,
      school: school.id,
      math: math.id,
      biology: biology.id,
      work: work.id,
      onCall: onCall.id,
      health: health.id,
    },
    events: { mathQuiz: mathQuiz.id, trip: trip.id, weeklyClass: weeklyClass.id, onCallShift: onCallShift.id },
  };
  writeFileSync(".playwright/fixtures.json", JSON.stringify(fixtures, null, 2));

  console.log(`Seeded ${env.DATABASE_URL} with 2 users, 10 calendars, 4 events.`);
  sqlite.close();
}

await main();
