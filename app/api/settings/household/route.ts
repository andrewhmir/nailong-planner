import { withViewer } from "@/lib/api/route";
import { updateHouseholdHandler } from "@/lib/api/handlers/settings";

export const dynamic = "force-dynamic";

export const PATCH = withViewer(({ db, ctx, request }) =>
  updateHouseholdHandler(db, ctx, request),
);
