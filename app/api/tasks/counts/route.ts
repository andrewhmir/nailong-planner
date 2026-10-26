import { withViewer } from "@/lib/api/route";
import { taskCountsHandler } from "@/lib/api/handlers/tasks";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx }) => taskCountsHandler(db, ctx));
