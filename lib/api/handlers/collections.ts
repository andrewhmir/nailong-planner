import { NextResponse } from "next/server";
import type { Database } from "@/lib/db/client";
import {
  createCollection,
  deleteCollection,
  ensureInbox,
  listCollectionTree,
  updateCollection,
} from "@/lib/services/collections";
import type { ViewerContext } from "@/lib/services/permissions";
import { createCollectionSchema, updateCollectionSchema } from "@/lib/validation/collections";
import { fieldErrors, guarded, readJson } from "./support";

export const listCollections = guarded((db: Database, ctx: ViewerContext): Response => {
  // Every user's tree contains their own Inbox; task creation (Task 5) also
  // relies on this lazy row, so the list handler is the first place it appears.
  ensureInbox(db, ctx);
  return NextResponse.json({ collections: listCollectionTree(db, ctx) });
});

export const createCollectionHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const parsed = createCollectionSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const collection = createCollection(db, ctx, parsed.data);
    return NextResponse.json({ collection }, { status: 201 });
  },
);

export const updateCollectionHandler = guarded(
  async (
    db: Database,
    ctx: ViewerContext,
    id: string,
    request: Request,
  ): Promise<Response> => {
    const parsed = updateCollectionSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw fieldErrors(parsed.error);
    }
    const collection = updateCollection(db, ctx, id, parsed.data);
    return NextResponse.json({ collection });
  },
);

export const deleteCollectionHandler = guarded(
  (db: Database, ctx: ViewerContext, id: string): Response => {
    deleteCollection(db, ctx, id);
    return new Response(null, { status: 204 });
  },
);
