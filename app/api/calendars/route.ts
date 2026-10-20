import { withViewer } from "@/lib/api/route";
import { createCalendarHandler, listCalendars } from "@/lib/api/handlers/calendars";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx }) => listCalendars(db, ctx));

export const POST = withViewer(({ db, ctx, request }) =>
  createCalendarHandler(db, ctx, request),
);
