import { withViewer } from "@/lib/api/route";
import { reorderTasksHandler } from "@/lib/api/handlers/tasks";

export const dynamic = "force-dynamic";

export const PATCH = withViewer(({ db, ctx, request }) =>
  reorderTasksHandler(db, ctx, request),
);
