import type { NextRequest } from "next/server";
import { withViewer } from "@/lib/api/route";
import { rollbackImportBatchHandler } from "@/lib/api/handlers/import";

export const dynamic = "force-dynamic";

const rollback = withViewer<{ id: string }>(({ db, ctx, id }) =>
  rollbackImportBatchHandler(db, ctx, id),
);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return rollback(request, { id });
}
