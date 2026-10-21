import { withViewer } from "@/lib/api/route";
import { listImportBatchesHandler } from "@/lib/api/handlers/import";

export const dynamic = "force-dynamic";

export const GET = withViewer(({ db, ctx }) => listImportBatchesHandler(db, ctx));
