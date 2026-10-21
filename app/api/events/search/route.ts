import { withViewer } from "@/lib/api/route";
import { searchEventsHandler } from "@/lib/api/handlers/events";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx, request }) => searchEventsHandler(db, ctx, request));
