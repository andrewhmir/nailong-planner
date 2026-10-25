import { describe, expect, it } from "vitest";
import type { CollectionRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  assertWritable,
  canWriteCollection,
  type ViewerContext,
} from "@/lib/services/permissions";

const viewerA: ViewerContext = { userId: "user-a", householdId: "h1" };
const viewerB: ViewerContext = { userId: "user-b", householdId: "h1" };

function calendar(overrides: Partial<CollectionRow>): CollectionRow {
  return {
    id: "c1",
    householdId: "h1",
    parentId: null,
    name: "School",
    hueFamily: "indigo",
    shadeIndex: 3,
    ownerId: null,
    kind: "calendar",
    visibility: "shared",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function effectiveOf(row: CollectionRow): Pick<CollectionRow, "ownerId" | "visibility" | "householdId"> {
  return { ownerId: row.ownerId, visibility: row.visibility, householdId: row.householdId };
}

function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected AppError, but call succeeded");
}

describe("canWriteCollection", () => {
  it("lets anyone in the household write a shared (ownerless) calendar", () => {
    expect(canWriteCollection(viewerA, calendar({ ownerId: null }))).toBe(true);
    expect(canWriteCollection(viewerB, calendar({ ownerId: null }))).toBe(true);
  });

  it("lets anyone write a calendar they do not own when it is not view-only", () => {
    expect(canWriteCollection(viewerA, calendar({ ownerId: "user-b" }))).toBe(true);
  });

  it("lets the owner write their own view-only calendar", () => {
    expect(
      canWriteCollection(viewerA, calendar({ ownerId: "user-a", visibility: "view_only" })),
    ).toBe(true);
  });

  it("blocks the partner from writing a view-only calendar they do not own", () => {
    expect(
      canWriteCollection(viewerB, calendar({ ownerId: "user-a", visibility: "view_only" })),
    ).toBe(false);
  });

  it("blocks everyone from writing a view-only calendar with no owner", () => {
    expect(canWriteCollection(viewerA, calendar({ ownerId: null, visibility: "view_only" }))).toBe(
      false,
    );
  });
});

describe("assertWritable", () => {
  const visibilities = ["shared", "view_only", "private"] as const;
  const owners = [
    { label: "me", ownerId: "user-a" },
    { label: "partner", ownerId: "user-b" },
    { label: "none", ownerId: null },
  ] as const;

  for (const visibility of visibilities) {
    for (const owner of owners) {
      it(`${visibility} owned by ${owner.label}`, () => {
        const row = calendar({ visibility, ownerId: owner.ownerId });
        const writable = canWriteCollection(viewerA, row);
        expect(writable).toBe(visibility === "shared" || owner.ownerId === viewerA.userId);

        if (writable) {
          expect(() => assertWritable(effectiveOf(row), viewerA)).not.toThrow();
          return;
        }

        const error = catchAppError(() => assertWritable(effectiveOf(row), viewerA));
        if (visibility === "private") {
          // A private row the viewer does not own must not leak its existence.
          expect(error.code).toBe("NOT_FOUND");
          expect(error.status).toBe(404);
        } else {
          expect(error.code).toBe("FORBIDDEN");
          expect(error.status).toBe(403);
        }
      });
    }
  }

  it("hides another household's collection even when it is shared", () => {
    const error = catchAppError(() => assertWritable(effectiveOf(calendar({ householdId: "h2" })), viewerA));
    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
  });
});
