"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { HUE_FAMILIES, PARENT_SHADE_INDEX, shadeTokens, type HueFamily } from "@/lib/color/palette";
import type { CalendarRow } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export type CalendarDialogState =
  | { mode: "create-root" }
  | { mode: "create-child"; parentId: string }
  | { mode: "edit"; calendar: CalendarRow };

export interface CalendarDialogResult {
  name: string;
  hueFamily?: HueFamily;
  ownerId?: string | null;
  /** @deprecated until Task 2: write-side compat; maps to collection.visibility. */
  isViewOnlyForPartner?: boolean;
}

interface Props {
  state: CalendarDialogState | null;
  pending: boolean;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onSubmit: (values: CalendarDialogResult) => void;
}

export function CalendarDialog({
  state,
  pending,
  currentUserId,
  currentUserName,
  onClose,
  onSubmit,
}: Props) {
  if (!state) {
    return null;
  }

  const isEdit = state.mode === "edit";
  const isRoot =
    state.mode === "create-root" || (isEdit && state.calendar.parentId === null);

  const title =
    state.mode === "create-root"
      ? "New calendar"
      : state.mode === "create-child"
        ? "Add sub-calendar"
        : isRoot
          ? "Calendar settings"
          : "Rename sub-calendar";
  const description =
    state.mode === "create-child"
      ? "It inherits the parent's color in a new shade."
      : isRoot
        ? "Shared calendars appear under Shared."
        : undefined;

  const formKey =
    state.mode === "create-root"
      ? "create-root"
      : state.mode === "create-child"
        ? `create-child-${state.parentId}`
        : `edit-${state.calendar.id}`;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={title} description={description}>
        <CalendarForm
          key={formKey}
          isRoot={isRoot}
          isEdit={isEdit}
          initialName={isEdit ? state.calendar.name : ""}
          initialHue={
            isEdit && state.calendar.hueFamily && isRoot
              ? (state.calendar.hueFamily as HueFamily)
              : "teal"
          }
          initialOwnerId={isEdit && isRoot ? state.calendar.ownerId : null}
          initialViewOnly={isEdit && isRoot ? state.calendar.visibility === "view_only" : false}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          pending={pending}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  isRoot: boolean;
  isEdit: boolean;
  initialName: string;
  initialHue: HueFamily;
  initialOwnerId: string | null;
  initialViewOnly: boolean;
  currentUserId: string;
  currentUserName: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: CalendarDialogResult) => void;
}

const CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink focus:border-accent";
const LABEL = "block text-base text-ink";

function CalendarForm({
  isRoot,
  isEdit,
  initialName,
  initialHue,
  initialOwnerId,
  initialViewOnly,
  currentUserId,
  currentUserName,
  pending,
  onClose,
  onSubmit,
}: FormProps) {
  const [name, setName] = useState(initialName);
  const [hueFamily, setHueFamily] = useState<HueFamily>(initialHue);
  const [ownerId, setOwnerId] = useState<string | null>(initialOwnerId);
  const [viewOnly, setViewOnly] = useState(initialViewOnly);

  const isMine = ownerId === currentUserId;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name,
          hueFamily: isRoot ? hueFamily : undefined,
          ownerId: isRoot ? ownerId : undefined,
          isViewOnlyForPartner: isRoot ? (isMine ? viewOnly : false) : undefined,
        });
      }}
    >
      <div className="space-y-1">
        <label className={LABEL} htmlFor="calendar-name">
          Name
        </label>
        <input
          id="calendar-name"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          className={CONTROL}
        />
      </div>

      {isRoot ? (
        <>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="calendar-owner">
              Belongs to
            </label>
            <select
              id="calendar-owner"
              value={ownerId ?? "ours"}
              onChange={(event) =>
                setOwnerId(event.target.value === "ours" ? null : currentUserId)
              }
              className={CONTROL}
            >
              <option value="ours">Shared</option>
              <option value={currentUserId}>{currentUserName}</option>
            </select>
          </div>

          <label className="flex items-start gap-2 text-base text-ink-soft">
            <input
              type="checkbox"
              checked={viewOnly && isMine}
              disabled={!isMine}
              onChange={(event) => setViewOnly(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border border-field accent-accent"
            />
            <span>
              View only
              <span className="mt-0.5 block text-xs text-ink-mute">
                {isMine
                  ? "Only you can edit this calendar and its sub-calendars."
                  : "Assign the calendar to yourself first."}
              </span>
            </span>
          </label>

          <fieldset>
            <legend className="mb-1 text-base text-ink">Color</legend>
            <div className="flex flex-wrap gap-2">
              {HUE_FAMILIES.map((family) => (
                <button
                  key={family}
                  type="button"
                  aria-label={`Color ${family}`}
                  aria-pressed={hueFamily === family}
                  onClick={() => setHueFamily(family)}
                  style={{ background: shadeTokens(family, PARENT_SHADE_INDEX).main }}
                  className={cn(
                    "h-6 w-6 rounded-sm transition",
                    hueFamily === family ? "ring-2 ring-ink ring-offset-1" : "opacity-80 hover:opacity-100",
                  )}
                />
              ))}
            </div>
          </fieldset>
        </>
      ) : null}

      {isEdit ? null : (
        <p className="text-xs text-ink-mute">
          Sub-calendars inherit this calendar&apos;s color and sharing.
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={pending || name.trim().length === 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
