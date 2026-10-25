import type { NextRequest } from "next/server";
import { withViewer } from "@/lib/api/route";
import {
  deleteTaskHandler,
  getTaskHandler,
  updateTaskHandler,
} from "@/lib/api/handlers/tasks";

export const dynamic = "force-dynamic";

const get = withViewer<{ id: string }>(({ db, ctx, id }) => getTaskHandler(db, ctx, id));

const patch = withViewer<{ id: string }>(({ db, ctx, request, id }) =>
  updateTaskHandler(db, ctx, id, request),
);

const remove = withViewer<{ id: string }>(({ db, ctx, id }) => deleteTaskHandler(db, ctx, id));

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return get(request, { id });
}

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
