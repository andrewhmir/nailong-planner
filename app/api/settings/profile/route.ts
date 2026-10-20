import { withViewer } from "@/lib/api/route";
import { updateProfileHandler } from "@/lib/api/handlers/settings";

export const dynamic = "force-dynamic";

export const PATCH = withViewer(({ db, ctx, request }) => updateProfileHandler(db, ctx, request));
