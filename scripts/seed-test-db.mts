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
const { createCollection, ensureInbox } = await import("../lib/services/collections");
const { createTask, updateTask } = await import("../lib/services/tasks");
const { createEvent } = await import("../lib/services/events");
const { endOfWeek, localToday } = await import("../lib/domain/tasks");
const { addDaysToDate, localWallTimeToUtc } = await import("../lib/time/zone");
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
  // Foreign keys are ON, so children come first: checklist items -> tasks ->
  // the collections that own them (deleting a collection cascades its events) ->
  // import history -> per-user/preference/auth rows -> the household and users.
  for (const table of [
    schema.taskChecklistItem,
    schema.task,
    schema.collection,
    schema.event,
    schema.importChange,
    schema.importBatch,
    schema.userPreference,
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

  // All dates below derive from the household's "today" rather than the host
  // clock, so the E2E suite stays green in any month. Task dates are derived in
  // full; the events keep fixed day-of-month anchors, noted at `dayMid` below.
  const today = localToday(household.timezone);
  const weekStartsOn: 0 | 1 = household.weekStartsOn === 1 ? 1 : 0;
  const weekEnd = endOfWeek(today, weekStartsOn);
  const yesterday = addDaysToDate(today, -1);
  const [year, month] = today.split("-") as [string, string];
  // The 15th/20th are the pre-v0.2 seed's event anchors, kept deliberately: only
  // the month is derived, and the exact day is not load-bearing for any spec.
  // The "no hardcoded dates" rule is about tasks, whose buckets depend on the
  // day they are scheduled or due; no task date below hardcodes one.
  const dayMid = `${year}-${month}-15`;
  const dayLater = `${year}-${month}-20`;

  // Ours
  const householdCollection = createCollection(db, andrew, { name: "Household", hueFamily: "teal" });
  const chores = createCollection(db, andrew, { name: "Chores", parentId: householdCollection.id });
  const trips = createCollection(db, andrew, { name: "Trips", parentId: householdCollection.id });

  // Mine
  const school = createCollection(db, andrew, { name: "School", hueFamily: "indigo", ownerId: andrew.userId });
  const math = createCollection(db, andrew, { name: "Math", parentId: school.id });
  const biology = createCollection(db, andrew, { name: "Biology", parentId: school.id });
  const work = createCollection(db, andrew, { name: "Work", hueFamily: "amber", ownerId: andrew.userId });
  const onCall = createCollection(db, andrew, { name: "On-call", parentId: work.id });
  // View-only lives on the root and cascades to its sub-calendars.
  updateCollection(db, andrew, work.id, { visibility: "view_only" });

  // Hers
  const health = createCollection(db, partner, { name: "Health", hueFamily: "rose", ownerId: partner.userId });
  createCollection(db, partner, { name: "Gym", parentId: health.id });

  // Task lists. `ensureInbox` is the same lazy path the app uses, so the seed
  // proves the per-user private Inbox identity instead of hand-rolling one.
  const andrewInbox = ensureInbox(db, andrew);
  const partnerInbox = ensureInbox(db, partner);
  const ours = createCollection(db, andrew, { name: "Ours", kind: "list", hueFamily: "violet" });
  const errands = createCollection(db, andrew, {
    name: "Errands",
    kind: "list",
    hueFamily: "amber",
    ownerId: andrew.userId,
  });
  const projects = createCollection(db, partner, {
    name: "Projects",
    kind: "list",
    hueFamily: "rose",
    ownerId: partner.userId,
  });
  const journal = createCollection(db, andrew, {
    name: "Journal",
    kind: "list",
    hueFamily: "slate",
    ownerId: andrew.userId,
    visibility: "private",
  });

  const mathQuiz = createEvent(db, andrew, {
    collectionId: math.id,
    title: "Math quiz",
    allDay: false,
    startAt: localWallTimeToUtc(`${dayLater}T09:00`, household.timezone),
    endAt: localWallTimeToUtc(`${dayLater}T10:00`, household.timezone),
  });
  const trip = createEvent(db, andrew, {
    collectionId: householdCollection.id,
    title: "Kyoto trip",
    allDay: true,
    startDate: dayMid,
    endDate: dayMid,
  });
  const weeklyClass = createEvent(db, andrew, {
    collectionId: school.id,
    title: "Weekly class",
    allDay: false,
    startAt: localWallTimeToUtc(`${dayMid}T13:00`, household.timezone),
    endAt: localWallTimeToUtc(`${dayMid}T14:00`, household.timezone),
    rrule: "FREQ=WEEKLY;BYDAY=TU",
  });
  const onCallShift = createEvent(db, andrew, {
    collectionId: onCall.id,
    title: "On-call shift",
    allDay: false,
    startAt: localWallTimeToUtc(`${dayMid}T18:00`, household.timezone),
    endAt: localWallTimeToUtc(`${dayMid}T20:00`, household.timezone),
  });

  // Tasks. Every bucket is populated: two undated Inbox captures, a task for
  // today, one for the end of the household week, a Someday project task, an
  // overdue deadline, a finished task, a shared-list task and two tasks in
  // Andrew's private Journal. On the last day of the household week
  // `weekEnd === today`, so the "week" task lands in Today (plan ruling R1);
  // that is still the honest week-end date.
  const inboxOne = createTask(db, andrew, {
    title: "Call the plumber",
    collectionId: andrewInbox.id,
  });
  const inboxTwo = createTask(db, andrew, {
    title: "Book a dentist appointment",
    collectionId: andrewInbox.id,
  });
  const todayTask = createTask(db, andrew, {
    title: "Take out the recycling",
    collectionId: andrewInbox.id,
    scheduledOn: today,
  });
  const weekTask = createTask(db, andrew, {
    title: "Plan the weekend groceries",
    collectionId: andrewInbox.id,
    scheduledOn: weekEnd,
  });
  const somedayTask = createTask(db, andrew, {
    title: "Draft the garden plan",
    collectionId: projects.id,
  });
  updateTask(db, andrew, somedayTask.id, {
    checklist: [
      { title: "Measure the beds", done: true },
      { title: "Pick a supplier", done: false },
    ],
  });
  const overdueTask = createTask(db, andrew, {
    title: "Renew the passport",
    collectionId: errands.id,
    dueOn: yesterday,
  });
  const doneTask = createTask(db, andrew, {
    title: "Water the plants",
    collectionId: errands.id,
  });
  updateTask(db, andrew, doneTask.id, { status: "done" });
  const sharedTask = createTask(db, andrew, {
    title: "Order more coffee beans",
    collectionId: ours.id,
  });
  const privateOne = createTask(db, andrew, {
    title: "Morning pages",
    collectionId: journal.id,
  });
  const privateTwo = createTask(db, andrew, {
    title: "Weekly reflection",
    collectionId: journal.id,
  });

  const tasks = [
    inboxOne,
    inboxTwo,
    todayTask,
    weekTask,
    somedayTask,
    overdueTask,
    doneTask,
    sharedTask,
    privateOne,
    privateTwo,
  ];

  // Fixture ids. The key names are the v0.2 dispatch's shape and stand:
  // `collections.{ours,errands,projects,journal,andrewInbox,partnerInbox}` and
  // `tasks.private` as a `string[]` (the plan sketch's single private id is
  // superseded). `tests/e2e/helpers.ts`'s `Fixtures` type mirrors this object.
  const fixtures = {
    householdId: household.id,
    password: PASSWORD,
    users: { andrew: andrew.userId, partner: partner.userId },
    calendars: {
      household: householdCollection.id,
      chores: chores.id,
      trips: trips.id,
      school: school.id,
      math: math.id,
      biology: biology.id,
      work: work.id,
      onCall: onCall.id,
      health: health.id,
    },
    collections: {
      ours: ours.id,
      errands: errands.id,
      projects: projects.id,
      journal: journal.id,
      andrewInbox: andrewInbox.id,
      partnerInbox: partnerInbox.id,
    },
    events: { mathQuiz: mathQuiz.id, trip: trip.id, weeklyClass: weeklyClass.id, onCallShift: onCallShift.id },
    tasks: {
      inbox: [inboxOne.id, inboxTwo.id],
      today: todayTask.id,
      week: weekTask.id,
      someday: somedayTask.id,
      overdue: overdueTask.id,
      done: doneTask.id,
      shared: sharedTask.id,
      private: [privateOne.id, privateTwo.id],
    },
  };
  writeFileSync(".playwright/fixtures.json", JSON.stringify(fixtures, null, 2));

  console.log(
    `Seeded ${env.DATABASE_URL} with 2 users, 10 calendars, 4 events, 6 lists and ${tasks.length} tasks.`,
  );
  sqlite.close();
}

await main();
