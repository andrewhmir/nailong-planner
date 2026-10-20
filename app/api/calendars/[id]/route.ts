import type { NextRequest } from "next/server";
import { withViewer } from "@/lib/api/route";
import {
  deleteCalendarHandler,
  updateCalendarHandler,
} from "@/lib/api/handlers/calendars";

export const dynamic = "force-dynamic";

const patch = withViewer<{ id: string }>(({ db, ctx, request, id }) =>
  updateCalendarHandler(db, ctx, id, request),
);

const remove = withViewer<{ id: string }>(({ db, ctx, id }) => deleteCalendarHandler(db, ctx, id));

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
