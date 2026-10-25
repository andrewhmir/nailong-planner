import type { NextRequest } from "next/server";
import { withViewer } from "@/lib/api/route";
import {
  deleteCollectionHandler,
  updateCollectionHandler,
} from "@/lib/api/handlers/collections";

export const dynamic = "force-dynamic";

const patch = withViewer<{ id: string }>(({ db, ctx, request, id }) =>
  updateCollectionHandler(db, ctx, id, request),
);

const remove = withViewer<{ id: string }>(({ db, ctx, id }) => deleteCollectionHandler(db, ctx, id));

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return patch(request, { id });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return remove(request, { id });
}
