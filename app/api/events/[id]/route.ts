import type { NextRequest } from "next/server";
import { withViewer } from "@/lib/api/route";
import { deleteEventHandler, updateEventHandler } from "@/lib/api/handlers/events";

export const dynamic = "force-dynamic";

const patch = withViewer<{ id: string }>(({ db, ctx, request, id }) =>
  updateEventHandler(db, ctx, id, request),
);

const remove = withViewer<{ id: string }>(({ db, ctx, request, id }) =>
  deleteEventHandler(db, ctx, id, request),
);

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
