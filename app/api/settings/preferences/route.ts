import { withViewer } from "@/lib/api/route";
import {
  getPreferencesHandler,
  updatePreferencesHandler,
} from "@/lib/api/handlers/preferences";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx }) => getPreferencesHandler(db, ctx));

export const PATCH = withViewer(({ db, ctx, request }) =>
  updatePreferencesHandler(db, ctx, request),
);
