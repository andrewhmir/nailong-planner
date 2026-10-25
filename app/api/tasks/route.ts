import { withViewer } from "@/lib/api/route";
import { createTaskHandler, listTasksHandler } from "@/lib/api/handlers/tasks";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx, request }) => listTasksHandler(db, ctx, request));

export const POST = withViewer(({ db, ctx, request }) => createTaskHandler(db, ctx, request));
