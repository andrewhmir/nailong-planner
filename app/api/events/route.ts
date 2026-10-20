import { withViewer } from "@/lib/api/route";
import { createEventHandler, listEventsHandler } from "@/lib/api/handlers/events";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx, request }) => listEventsHandler(db, ctx, request));

export const POST = withViewer(({ db, ctx, request }) => createEventHandler(db, ctx, request));
