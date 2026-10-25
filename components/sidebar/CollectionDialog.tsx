"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { HUE_FAMILIES, PARENT_SHADE_INDEX, shadeTokens, type HueFamily } from "@/lib/color/palette";
import type { CollectionKind, CollectionRow, CollectionVisibility } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export type CollectionDialogState =
  | { mode: "create-root"; kind: CollectionKind }
  | {
      mode: "create-child";
      parentId: string;
      kind: CollectionKind;
      /** The parent root's visibility, which the child inherits and cannot change. */
      parentVisibility: CollectionVisibility;
    }
  | {
      mode: "edit";
      collection: CollectionRow;
      /** The root's visibility, used to show a child the value it inherits. */
      inheritedVisibility?: CollectionVisibility;
    };

export interface CollectionDialogResult {
  name: string;
  /** Root creation only; a child inherits its parent's kind. */
  kind?: CollectionKind;
  hueFamily?: HueFamily;
  ownerId?: string | null;
  /**
   * Three-valued, exactly like the column. A root edit must send its current
   * value back even when the user only renamed it, or a private collection
   * would be silently downgraded to `shared`.
   */
  visibility?: CollectionVisibility;
}

interface Props {
  state: CollectionDialogState | null;
  pending: boolean;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onSubmit: (values: CollectionDialogResult) => void;
}

const VISIBILITY_OPTIONS: { value: CollectionVisibility; label: string }[] = [
  { value: "shared", label: "Shared" },
  { value: "view_only", label: "View only" },
  { value: "private", label: "Private" },
];

export function CollectionDialog({
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
  const isRoot = state.mode === "create-root" || (isEdit && state.collection.parentId === null);
  const kind: CollectionKind =
    state.mode === "edit" ? state.collection.kind : state.kind;
  const noun = kind === "list" ? "list" : "calendar";
  const nounTitle = kind === "list" ? "List" : "Calendar";

  const title =
    state.mode === "create-root"
      ? `New ${noun}`
      : state.mode === "create-child"
        ? `Add sub-${noun}`
        : isRoot
          ? `${nounTitle} settings`
          : `Rename sub-${noun}`;
  const description =
    state.mode === "create-child"
      ? `It inherits the parent's color and visibility in a new shade.`
      : isRoot
        ? `Shared ${noun}s appear under Shared; private ones stay with their owner.`
        : undefined;

  const formKey =
    state.mode === "create-root"
      ? `create-root-${state.kind}`
      : state.mode === "create-child"
        ? `create-child-${state.parentId}`
        : `edit-${state.collection.id}`;

  // A child shows the value it inherits; only a root edit/create starts from a
  // value the dialog can change. A root defaults to `shared`, a child inherits
  // its parent's value (children are always stored as `shared` themselves).
  const initialVisibility: CollectionVisibility =
    state.mode === "edit"
      ? state.collection.parentId === null
        ? state.collection.visibility
        : (state.inheritedVisibility ?? "shared")
      : state.mode === "create-child"
        ? state.parentVisibility
        : "shared";

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={title} description={description}>
        <CollectionForm
          key={formKey}
          kind={kind}
          isRoot={isRoot}
          isEdit={isEdit}
          initialName={isEdit ? state.collection.name : ""}
          initialHue={
            isEdit && state.collection.hueFamily && isRoot
              ? (state.collection.hueFamily as HueFamily)
              : "teal"
          }
          initialOwnerId={isEdit && isRoot ? state.collection.ownerId : null}
          initialVisibility={initialVisibility}
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
  kind: CollectionKind;
  isRoot: boolean;
  isEdit: boolean;
  initialName: string;
  initialHue: HueFamily;
  initialOwnerId: string | null;
  initialVisibility: CollectionVisibility;
  currentUserId: string;
  currentUserName: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: CollectionDialogResult) => void;
}

const CONTROL =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink focus:border-accent";
const LABEL = "block text-base text-ink";

function CollectionForm({
  kind,
  isRoot,
  isEdit,
  initialName,
  initialHue,
  initialOwnerId,
  initialVisibility,
  currentUserId,
  currentUserName,
  pending,
  onClose,
  onSubmit,
}: FormProps) {
  const [name, setName] = useState(initialName);
  const [hueFamily, setHueFamily] = useState<HueFamily>(initialHue);
  const [ownerId, setOwnerId] = useState<string | null>(initialOwnerId);
  const [visibility, setVisibility] = useState<CollectionVisibility>(initialVisibility);

  const isMine = ownerId === currentUserId;
  // Only the owner can pick a restrictive value, and only a root carries one:
  // the server rejects view-only/private without an owner and rejects both on
  // children, which inherit their parent's value instead.
  const canEditVisibility = isRoot && isMine;
  const noun = kind === "list" ? "list" : "calendar";

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name,
          ...(isRoot ? { kind } : {}),
          hueFamily: isRoot ? hueFamily : undefined,
          ownerId: isRoot ? ownerId : undefined,
          // Never send a less restrictive value than the stored one: a private
          // root being renamed must stay private, and a shared root cannot be
          // view-only or private until it is assigned to its owner.
          visibility: isRoot ? (isMine ? visibility : "shared") : undefined,
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
              onChange={(event) => {
                const nextOwnerId = event.target.value === "ours" ? null : currentUserId;
                setOwnerId(nextOwnerId);
                // A shared collection cannot be view-only or private, so the
                // control must fall back to the value the server will store.
                if (nextOwnerId === null) {
                  setVisibility("shared");
                }
              }}
              className={CONTROL}
            >
              <option value="ours">Shared</option>
              <option value={currentUserId}>{currentUserName}</option>
            </select>
          </div>

          <fieldset>
            <legend className="mb-1 text-base text-ink">Visibility</legend>
            <div className="space-y-1">
              {VISIBILITY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-base text-ink-soft"
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={visibility === option.value}
                    disabled={!canEditVisibility}
                    onChange={() => setVisibility(option.value)}
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-mute">
              {isMine
                ? `View only and Private apply to this ${noun} and its sub-${noun}s.`
                : `Assign this ${noun} to yourself to change who can see it.`}
            </p>
          </fieldset>

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
      ) : (
        <fieldset>
          <legend className="mb-1 text-base text-ink">Visibility</legend>
          <div className="space-y-1">
            {VISIBILITY_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-base text-ink-soft">
                <input
                  type="radio"
                  name="visibility"
                  value={option.value}
                  checked={visibility === option.value}
                  disabled
                  onChange={() => undefined}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-mute">
            Sub-{noun}s inherit their parent&apos;s visibility; change the top-level {noun} instead.
          </p>
        </fieldset>
      )}

      {isEdit ? null : (
        <p className="text-xs text-ink-mute">
          Sub-{noun}s inherit this {noun}&apos;s color and sharing.
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
