import { describe, expect, it } from "vitest";
import type { ShadeTokens } from "@/lib/color/palette";
import { applyEventPatch, removeEvent, replaceEvent } from "@/lib/query/eventCache";
import type { EventView } from "@/lib/services/events";

function makeEvent(overrides: Partial<EventView>): EventView {
  return {
    id: "e1",
    householdId: "h1",
    calendarId: "c1",
    title: "Dentist",
    description: null,
    location: null,
    allDay: 0,
    startAt: 1_000,
    endAt: 2_000,
    startDate: null,
    endDate: null,
    rrule: null,
    exdates: null,
    recurrenceParentId: null,
    recurrenceId: null,
    tzid: null,
    externalSource: null,
    externalUid: null,
    externalRecurrenceId: null,
    externalKey: null,
    externalContentHash: null,
    createdBy: "user-a",
    createdAt: 0,
    updatedAt: 0,
    color: {} as ShadeTokens,
    ...overrides,
  };
}

describe("applyEventPatch", () => {
  it("patches one event in every cached range without mutating the input", () => {
    const before = [makeEvent({ id: "e1", title: "Dentist" })];
    const after = applyEventPatch(before, "e1", { title: "Dentist (moved)" });
    expect(after[0]?.title).toBe("Dentist (moved)");
    expect(before[0]?.title).toBe("Dentist");
    expect(after).not.toBe(before);
  });

  it("leaves other events alone and tolerates a missing id", () => {
    const before = [makeEvent({ id: "e1" }), makeEvent({ id: "e2", title: "Gym" })];
    const after = applyEventPatch(before, "missing", { title: "Nope" });
    expect(after.map((event) => event.title)).toEqual(["Dentist", "Gym"]);
    expect(applyEventPatch(before, "e2", { title: "Gym class" })[1]?.title).toBe("Gym class");
    expect(before[1]?.title).toBe("Gym");
  });
});

describe("removeEvent", () => {
  it("removes by id and leaves the rest in order", () => {
    const before = [makeEvent({ id: "e1" }), makeEvent({ id: "e2" })];
    expect(removeEvent(before, "e1").map((event) => event.id)).toEqual(["e2"]);
    expect(before.map((event) => event.id)).toEqual(["e1", "e2"]);
  });
});

describe("replaceEvent", () => {
  it("replaces a temp event with the server row", () => {
    const before = [makeEvent({ id: "temp-123", title: "New event" })];
    const after = replaceEvent(before, makeEvent({ id: "real", title: "New event" }));
    expect(after.map((event) => event.id)).toEqual(["real"]);
  });

  it("keeps the order of the row it replaces", () => {
    const before = [
      makeEvent({ id: "e1" }),
      makeEvent({ id: "temp-123" }),
      makeEvent({ id: "e2" }),
    ];
    const after = replaceEvent(before, makeEvent({ id: "real" }));
    expect(after.map((event) => event.id)).toEqual(["e1", "real", "e2"]);
  });
});
