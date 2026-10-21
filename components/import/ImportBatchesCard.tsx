"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ImportBatchView } from "@/lib/services/import";

const CARD = "scroll-mt-6 rounded-md border border-line-strong bg-surface p-6";
const CARD_HEADING = "border-b border-line pb-3 text-2xl font-normal text-ink";

interface Props {
  onUndo: (batchId: string) => Promise<void>;
  busy: boolean;
}

async function fetchBatches(): Promise<ImportBatchView[]> {
  const response = await fetch("/api/import/batches");
  const payload = (await response.json().catch(() => null)) as
    | { batches?: ImportBatchView[]; error?: { message?: string } }
    | null;
  if (!response.ok || !payload?.batches) {
    throw new Error(payload?.error?.message ?? "Could not load past imports.");
  }
  return payload.batches;
}

/** Settings → Import: past import batches, each undoable while committed. */
export function ImportBatchesCard({ onUndo, busy }: Props) {
  const { data, isError, error } = useQuery({
    queryKey: ["import-batches"],
    queryFn: fetchBatches,
  });

  return (
    <section className={CARD}>
      <h2 className={CARD_HEADING}>Past imports</h2>
      {isError ? (
        <p className="mt-6 text-sm text-ink-soft">{(error as Error).message}</p>
      ) : null}
      {!isError && (data ?? []).length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">No imports yet.</p>
      ) : null}
      {(data ?? []).length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th scope="col" className="py-2 pr-3 font-normal">
                  When
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Source
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Added
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Updated
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Status
                </th>
                <th scope="col" className="py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((batch) => (
                <tr key={batch.id} className="border-b border-line">
                  <td className="py-2 pr-3">
                    {new Intl.DateTimeFormat("en-AU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(batch.createdAt))}
                  </td>
                  <td className="py-2 pr-3">{batch.sourceName}</td>
                  <td className="py-2 pr-3">{batch.created}</td>
                  <td className="py-2 pr-3">{batch.updated}</td>
                  <td className="py-2 pr-3">
                    {batch.status === "committed" ? "Committed" : "Undone"}
                  </td>
                  <td className="py-2">
                    {batch.status === "committed" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          void onUndo(batch.id).catch((error: unknown) =>
                            toast.error((error as Error).message),
                          );
                        }}
                      >
                        Undo
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
