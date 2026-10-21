import { withViewer } from "@/lib/api/route";
import { previewImportHandler } from "@/lib/api/handlers/import";

export const dynamic = "force-dynamic";

export const POST = withViewer(({ db, ctx, request }) => previewImportHandler(db, ctx, request));
