"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImportBatchesCard } from "@/components/import/ImportBatchesCard";
import { Button } from "@/components/ui/button";
import { useCollections } from "@/lib/query/collections";
import type { ImportCalendarMode, ImportPreview, ImportReport } from "@/lib/services/import";
import { canWriteCollection } from "@/lib/services/permissions";

// Canvas card and field recipes, copied from SettingsForm.tsx (the files are
// not imported from a shared module there, so change them together).
const FIELD =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LABEL = "mb-1 block text-base text-ink";
const CARD = "scroll-mt-6 rounded-md border border-line-strong bg-surface p-6";
const CARD_HEADING = "border-b border-line pb-3 text-2xl font-normal text-ink";

type Step = "upload" | "preview" | "mapping" | "report";

interface ApiErrorBody {
  error?: { message?: string };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok || payload === null) {
    throw new Error(payload?.error?.message ?? "Something went wrong.");
  }
  return payload as T;
}

/**
 * Settings → Import from Google Calendar. Four steps: upload exported `.ics`
 * files, review the preview, map each source calendar, commit and report.
 * Nothing is written until the commit; every commit can be undone.
 */
export function ImportWizard({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportCalendarMode>>({});
  const [busy, setBusy] = useState(false);
  const { data: collectionTree } = useCollections();

  const writableCollections = (() => {
    const viewer = { userId: currentUserId, householdId: "" };
    const entries: Array<{ id: string; name: string }> = [];
    for (const root of collectionTree ?? []) {
      if (canWriteCollection(viewer, root)) {
        entries.push({ id: root.id, name: root.name });
      }
      for (const child of root.children) {
        const effective = {
          ownerId: root.ownerId ?? child.ownerId,
          visibility: root.visibility === "shared" ? child.visibility : root.visibility,
        };
        if (canWriteCollection(viewer, effective)) {
          entries.push({ id: child.id, name: `${root.name} / ${child.name}` });
        }
      }
    }
    return entries;
  })();

  const writeCount = (preview?.createCount ?? 0) + (preview?.updateCount ?? 0);

  async function startPreview(selected: File[]) {
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of selected) {
        form.append("files", file);
      }
      const payload = await readJson<{ preview: ImportPreview }>(
        await fetch("/api/import/preview", { method: "POST", body: form }),
      );
      setFiles(selected);
      setPreview(payload.preview);
      setMapping(
        Object.fromEntries(
          payload.preview.calendars.map((calendar) => [calendar.name, { mode: "new" as const }]),
        ),
      );
      setStep("preview");
    } catch (error) {
      toast.error((error as Error).message);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) {
        form.append("files", file);
      }
      form.append("mapping", JSON.stringify(mapping));
      const payload = await readJson<{ report: ImportReport }>(
        await fetch("/api/import/commit", { method: "POST", body: form }),
      );
      setReport(payload.report);
      setStep("report");
      toast.success("Import complete");
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["import-batches"] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function undoImport(batchId: string) {
    setBusy(true);
    try {
      const payload = await readJson<{ rollback: { batchId: string; skipped: number } }>(
        await fetch(`/api/import/batches/${batchId}/rollback`, { method: "POST" }),
      );
      toast.success(
        payload.rollback.skipped > 0
          ? `Import undone — ${payload.rollback.skipped} event(s) kept because they changed after the import`
          : "Import undone",
      );
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      if (report?.batchId === batchId) {
        setReport(null);
        setPreview(null);
        setFiles([]);
        setStep("upload");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const steps: Array<{ id: Step; label: string }> = [
    { id: "upload", label: "Choose files" },
    { id: "preview", label: "Preview" },
    { id: "mapping", label: "Map calendars" },
    { id: "report", label: "Done" },
  ];
  const activeIndex = steps.findIndex((entry) => entry.id === step);

  return (
    <div className="mt-6 space-y-6">
      <ol className="flex flex-wrap gap-2 text-sm text-ink-soft" aria-label="Import steps">
        {steps.map((entry, index) => (
          <li
            key={entry.id}
            aria-current={entry.id === step ? "step" : undefined}
            className={
              entry.id === step
                ? "rounded-sm bg-info-soft px-2 py-1 font-bold text-ink"
                : "rounded-sm px-2 py-1"
            }
          >
            {index + 1}. {entry.label}
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <section className={CARD}>
          <h2 className={CARD_HEADING}>Choose files</h2>
          <p className="mt-6 text-sm text-ink-soft">
            In Google Calendar open Settings → Import &amp; export → Export, or download your data
            with Google Takeout. Unzip the download, then choose one or more <code>.ics</code> files
            here. Nothing is written until you press Import.
          </p>
          <div className="mt-6">
            <label className={LABEL} htmlFor="import-files">
              Google Calendar files
            </label>
            <input
              ref={fileInputRef}
              id="import-files"
              type="file"
              accept=".ics,text/calendar"
              multiple
              aria-label="Google Calendar files"
              disabled={busy}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                if (selected.length > 0) {
                  void startPreview(selected);
                }
              }}
              className={FIELD}
            />
          </div>
          {busy ? <p className="mt-3 text-sm text-ink-soft">Reading the export…</p> : null}
        </section>
      ) : null}

      {step === "preview" && preview ? (
        <section className={CARD}>
          <h2 className={CARD_HEADING}>Preview</h2>
          <p className="mt-6 text-sm text-ink-soft">
            {preview.createCount} to add, {preview.updateCount} to update, {preview.unchangedCount}{" "}
            already up to date.
          </p>
          {preview.nonHouseholdTimezones.length > 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              These series keep their own timezone: {preview.nonHouseholdTimezones.join(", ")}.
            </p>
          ) : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Calendar
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Events
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Range
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Repeating
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Overrides
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Add
                  </th>
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Update
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    Unchanged
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.calendars.map((calendar) => (
                  <tr key={calendar.name} className="border-b border-line">
                    <td className="py-2 pr-3">{calendar.name}</td>
                    <td className="py-2 pr-3">{calendar.events}</td>
                    <td className="py-2 pr-3">
                      {calendar.earliest ?? "—"}
                      {calendar.latest && calendar.latest !== calendar.earliest
                        ? ` – ${calendar.latest}`
                        : ""}
                    </td>
                    <td className="py-2 pr-3">{calendar.recurring}</td>
                    <td className="py-2 pr-3">{calendar.overrides}</td>
                    <td className="py-2 pr-3">{calendar.createCount}</td>
                    <td className="py-2 pr-3">{calendar.updateCount}</td>
                    <td className="py-2">{calendar.unchangedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.warnings.length > 0 ? (
            <div role="status" className="mt-4 rounded-md bg-well p-3 text-sm text-ink-soft">
              <p className="font-bold text-ink">Some events were skipped</p>
              <ul className="mt-1 list-disc pl-5">
                {preview.warnings.slice(0, 10).map((warning, index) => (
                  <li key={`${warning.uid}-${index}`}>
                    {warning.title}: {warning.reason}
                  </li>
                ))}
                {preview.warnings.length > 10 ? (
                  <li>…and {preview.warnings.length - 10} more.</li>
                ) : null}
              </ul>
            </div>
          ) : null}
          {preview.dropped.alarms + preview.dropped.attendees + preview.dropped.attachments > 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              Not imported: {preview.dropped.alarms} reminders, {preview.dropped.attendees} guests,{" "}
              {preview.dropped.attachments} attachments.
            </p>
          ) : null}
          <div className="mt-6 flex justify-between">
            <Button
              onClick={() => {
                setStep("upload");
                setPreview(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              }}
            >
              Back
            </Button>
            <Button variant="primary" onClick={() => setStep("mapping")}>
              Continue
            </Button>
          </div>
        </section>
      ) : null}

      {step === "mapping" && preview ? (
        <section className={CARD}>
          <h2 className={CARD_HEADING}>Map calendars</h2>
          <p className="mt-6 text-sm text-ink-soft">
            Each Google calendar becomes a sub-calendar of a new “From Google” calendar you own,
            unless you choose an existing calendar.
          </p>
          <div className="mt-3 space-y-3">
            {preview.calendars.map((calendar) => {
              const entry = mapping[calendar.name] ?? { mode: "new" };
              const value = entry.mode === "new" ? "new" : `existing:${entry.collectionId}`;
              return (
                <div key={calendar.name}>
                  <label className={LABEL} htmlFor={`import-target-${calendar.name}`}>
                    {calendar.name}
                  </label>
                  <select
                    id={`import-target-${calendar.name}`}
                    aria-label={`Import target for ${calendar.name}`}
                    className={FIELD}
                    value={value}
                    disabled={busy}
                    onChange={(event) => {
                      const next = event.target.value;
                      setMapping((current) => ({
                        ...current,
                        [calendar.name]:
                          next === "new"
                            ? { mode: "new" }
                            : { mode: "existing", collectionId: next.replace("existing:", "") },
                      }));
                    }}
                  >
                    <option value="new">Create a new calendar under “From Google” (yours)</option>
                    {writableCollections.map((target) => (
                      <option key={target.id} value={`existing:${target.id}`}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="mt-6 flex justify-between">
            <Button onClick={() => setStep("preview")} disabled={busy}>
              Back
            </Button>
            <Button variant="primary" onClick={commit} disabled={busy}>
              {busy ? "Importing…" : `Import ${writeCount} event${writeCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "report" && report ? (
        <section className={CARD}>
          <h2 className={CARD_HEADING}>Import complete</h2>
          <p className="mt-6 text-sm text-ink">
            {report.created} added, {report.updated} updated, {report.unchanged} already up to date.
          </p>
          {report.calendarsCreated.length > 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              New calendars: {report.calendarsCreated.join(", ")}.
            </p>
          ) : null}
          {report.warnings.length > 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              {report.warnings.length} events were skipped; the preview lists the reasons.
            </p>
          ) : null}
          {report.dropped.alarms + report.dropped.attendees + report.dropped.attachments > 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              Not imported: {report.dropped.alarms} reminders, {report.dropped.attendees} guests,{" "}
              {report.dropped.attachments} attachments.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex h-[38px] items-center rounded-md border border-[#2468a2] bg-accent px-3 text-base text-white hover:bg-accent-hover"
            >
              Go to calendar
            </Link>
            <Button
              variant="outline"
              onClick={() => void undoImport(report.batchId)}
              disabled={busy}
            >
              Undo this import
            </Button>
          </div>
        </section>
      ) : null}

      <ImportBatchesCard onUndo={undoImport} busy={busy} />
    </div>
  );
}
