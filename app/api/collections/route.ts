import { withViewer } from "@/lib/api/route";
import { createCollectionHandler, listCollections } from "@/lib/api/handlers/collections";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx }) => listCollections(db, ctx));

export const POST = withViewer(({ db, ctx, request }) =>
  createCollectionHandler(db, ctx, request),
);
