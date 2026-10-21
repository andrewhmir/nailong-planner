import { withViewer } from "@/lib/api/route";
import { commitImportHandler } from "@/lib/api/handlers/import";

export const dynamic = "force-dynamic";

export const POST = withViewer(({ db, ctx, request }) => commitImportHandler(db, ctx, request));
