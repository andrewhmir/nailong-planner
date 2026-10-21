import { NextResponse } from "next/server";
import type { Database } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  commitImport,
  listImportBatches,
  previewImport,
  rollbackImportBatch,
  type ImportFile,
  type ImportMapping,
} from "@/lib/services/import";
import type { ViewerContext } from "@/lib/services/permissions";
import { guarded } from "./support";

interface ImportRequest {
  files: ImportFile[];
  /** Raw `mapping` form field (JSON text), or null when absent. */
  mapping: unknown;
}

/**
 * Reads the multipart body used by both import endpoints: repeated `files`
 * fields carrying `.ics` documents and an optional JSON `mapping` field. The
 * files are held in memory only and the service enforces the size limit.
 */
async function readImportRequest(request: Request): Promise<ImportRequest> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("VALIDATION", "Send the export as multipart/form-data.", 400);
  }

  const files: ImportFile[] = [];
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") {
      continue;
    }
    const name = "name" in entry && typeof entry.name === "string" ? entry.name : "import.ics";
    files.push({ name, text: await entry.text() });
  }

  const rawMapping = form.get("mapping");
  if (typeof rawMapping !== "string") {
    return { files, mapping: null };
  }
  try {
    return { files, mapping: JSON.parse(rawMapping) };
  } catch {
    throw new AppError("VALIDATION", "Send the calendar mapping as JSON.", 400);
  }
}

/** `POST /api/import/preview` — parse and count, never write. */
export const previewImportHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const { files } = await readImportRequest(request);
    return NextResponse.json({ preview: previewImport(db, ctx, files) });
  },
);

/** `POST /api/import/commit` — apply the mapping and return the batch report. */
export const commitImportHandler = guarded(
  async (db: Database, ctx: ViewerContext, request: Request): Promise<Response> => {
    const { files, mapping } = await readImportRequest(request);
    if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new AppError("VALIDATION", "Choose where each calendar goes.", 400, {
        mapping: "Send the calendar mapping as JSON.",
      });
    }
    const report = commitImport(db, ctx, { files, mapping: mapping as ImportMapping });
    return NextResponse.json({ report }, { status: 201 });
  },
);

/** `GET /api/import/batches` — import history, newest first. */
export const listImportBatchesHandler = guarded(
  (db: Database, ctx: ViewerContext): Response =>
    NextResponse.json({ batches: listImportBatches(db, ctx) }),
);

/** `POST /api/import/batches/[id]/rollback` — undo one committed batch. */
export const rollbackImportBatchHandler = guarded(
  (db: Database, ctx: ViewerContext, id: string): Response =>
    NextResponse.json({ rollback: rollbackImportBatch(db, ctx, id) }),
);
