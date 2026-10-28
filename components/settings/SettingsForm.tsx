"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarPreferencesCard } from "@/components/settings/CalendarPreferencesCard";
import { InstallAppCard } from "@/components/settings/InstallAppCard";
import { Button } from "@/components/ui/button";
import type { UserPreferences } from "@/lib/services/preferences";
import { cn } from "@/lib/utils";

interface HouseholdValues {
  name: string;
  timezone: string;
  weekStartsOn: number;
}

interface Props {
  initialName: string;
  initialHousehold: HouseholdValues;
  initialPreferences: UserPreferences;
  currentUserId: string;
  currentUserEmail: string;
}

const TIMEZONES = [
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Singapore",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "UTC",
];

// Canvas field and card recipes. The calendar dialog keeps its own copy of the
// field recipe in EventDialog.tsx; the two are not imported from a shared
// module, so change them together. No `outline-none` here: Tailwind v4 compiles
// it to `--tw-outline-style: none`, which `outline-2` then reads back, silently
// collapsing the focus ring to the 1px accent border.
const FIELD =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const LABEL = "mb-1 block text-base text-ink";
const CARD = "scroll-mt-6 rounded-md border border-line-strong bg-surface p-6";
const CARD_HEADING = "border-b border-line pb-3 text-2xl font-normal text-ink";

/** The sub-nav's sections, in document order. */
const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "household", label: "Household" },
  { id: "calendar", label: "Calendar" },
  { id: "account", label: "Account" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsForm({
  initialName,
  initialHousehold,
  initialPreferences,
  currentUserId,
  currentUserEmail,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [household, setHousehold] = useState<HouseholdValues>(initialHousehold);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingHousehold, setSavingHousehold] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const [activeSection, setActiveSection] = useState<SectionId>("profile");

  // The sections are in-page anchors rather than routes, and the page is short
  // enough that a scroll spy measured wrong at this height (its bottom clamp
  // highlighted Account while the reader was on Household). The URL hash is the
  // honest state: a direct load of /settings#account marks Account, clicking a
  // link fires hashchange, and the highlight deliberately does not follow a
  // manual scroll.
  useEffect(() => {
    function syncFromHash() {
      const id = window.location.hash.slice(1);
      const section = SECTIONS.find((candidate) => candidate.id === id);
      if (section) {
        setActiveSection(section.id);
      }
    }

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        throw new Error("Could not save your name.");
      }
      toast.success("Profile updated");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveHousehold() {
    setSavingHousehold(true);
    try {
      const response = await fetch("/api/settings/household", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(household),
      });
      if (!response.ok) {
        throw new Error("Could not save the household.");
      }
      toast.success("Household updated");
      // Timezone/week-start changes are read server-side, so re-render them.
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingHousehold(false);
    }
  }

  async function changePassword() {
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
      });
      if (!response.ok) {
        throw new Error("Could not change the password. Check the current one.");
      }
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function enableTwoFactor() {
    try {
      const response = await fetch("/api/auth/two-factor/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: twoFactorPassword }),
      });
      if (!response.ok) {
        throw new Error("Could not start two-factor setup. Check your password.");
      }
      const payload = (await response.json()) as { totpURI?: string; backupCodes?: string[] };
      setTotpUri(payload.totpURI ?? null);
      setBackupCodes(payload.backupCodes ?? []);
      toast.success("Add the key to your authenticator, then confirm a code.");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function verifyTwoFactor() {
    try {
      const response = await fetch("/api/auth/two-factor/verify-totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: twoFactorCode }),
      });
      if (!response.ok) {
        throw new Error("That code did not work. Try the next one.");
      }
      setTwoFactorEnabled(true);
      setTwoFactorCode("");
      toast.success("Two-factor authentication is on");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[192px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="self-start md:sticky md:top-6">
        <ul className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map((section) => {
            const active = activeSection === section.id;
            return (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#${section.id}`}
                  aria-current={active ? "location" : undefined}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "block whitespace-nowrap rounded-sm px-3 py-2 text-base text-ink transition-colors duration-200",
                    active
                      ? "bg-info-soft font-bold shadow-[inset_2px_0_0_var(--color-accent)]"
                      : "hover:bg-well",
                  )}
                >
                  {section.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 space-y-6">
        <section id="profile" className={CARD}>
          <h2 className={CARD_HEADING}>Profile</h2>
          <div className="mt-6 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className={LABEL} htmlFor="display-name">
                Display name
              </label>
              <input
                id="display-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={FIELD}
              />
            </div>
            <Button variant="primary" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </section>

        <section id="household" className={CARD}>
          <h2 className={CARD_HEADING}>Household</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="household-name">
                Household name
              </label>
              <input
                id="household-name"
                value={household.name}
                onChange={(event) => setHousehold({ ...household, name: event.target.value })}
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="household-timezone">
                Timezone
              </label>
              <select
                id="household-timezone"
                value={household.timezone}
                onChange={(event) => setHousehold({ ...household, timezone: event.target.value })}
                className={FIELD}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="week-start">
                Week starts on
              </label>
              <select
                id="week-start"
                value={household.weekStartsOn}
                onChange={(event) =>
                  setHousehold({ ...household, weekStartsOn: Number(event.target.value) })
                }
                className={FIELD}
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
              </select>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" onClick={saveHousehold} disabled={savingHousehold}>
              {savingHousehold ? "Saving…" : "Save household"}
            </Button>
          </div>
        </section>

        <CalendarPreferencesCard
          initialPreferences={initialPreferences}
          currentUserId={currentUserId}
        />

        <section className={CARD}>
          <h2 className={CARD_HEADING}>Google Calendar import</h2>
          <p className="mt-6 text-sm text-ink-soft">
            Bring your exported Google Calendar events into Nailong. You will preview every
            calendar before anything is written, and each import can be undone afterwards.
          </p>
          <div className="mt-3">
            <Link
              href="/settings/import"
              className="inline-flex h-[38px] items-center rounded-md border border-line-strong bg-well px-3 text-base text-ink hover:bg-line"
            >
              Open the importer
            </Link>
          </div>
        </section>

        <InstallAppCard />

        <div id="account" className="scroll-mt-6 space-y-6">
          {/* A real <form> with the password-manager tokens is what lets Chrome
              (and 1Password/Bitwarden/Safari) detect this card: it offers to
              generate a strong password in the empty new-password field, and
              offers to update the saved credential once the submit succeeds.
              The hidden username input tells the manager which account to update. */}
          <form
            className={CARD}
            onSubmit={(event) => {
              event.preventDefault();
              void changePassword();
            }}
            noValidate
          >
            <h2 className={CARD_HEADING}>Password</h2>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={currentUserEmail}
              readOnly
              hidden
              aria-hidden="true"
              tabIndex={-1}
            />
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="current-password">
                  Current password
                </label>
                <input
                  id="current-password"
                  name="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="new-password">
                  New password
                </label>
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={FIELD}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="submit" disabled={!currentPassword || newPassword.length < 12}>
                Change password
              </Button>
            </div>
          </form>

          <section className={CARD}>
            <h2 className={CARD_HEADING}>Two-factor authentication</h2>
            <p className="mt-6 text-sm text-ink-soft">
              Recommended. You will need an authenticator app; keep the backup codes somewhere safe.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <label className={LABEL} htmlFor="twofactor-password">
                  Account password
                </label>
                <input
                  id="twofactor-password"
                  name="account-password"
                  type="password"
                  autoComplete="current-password"
                  value={twoFactorPassword}
                  onChange={(event) => setTwoFactorPassword(event.target.value)}
                  className={FIELD}
                />
              </div>
              <Button variant="primary" onClick={enableTwoFactor} disabled={!twoFactorPassword}>
                Set up two-factor
              </Button>
            </div>

            {totpUri ? (
              <div className="mt-6 space-y-3 rounded-lg bg-well p-3">
                <p className="text-sm font-bold text-ink">Add this key to your authenticator app:</p>
                <code className="block break-all rounded-sm border border-line-strong bg-surface px-2 py-1 text-xs text-ink-soft">
                  {totpUri}
                </code>
                {backupCodes.length > 0 ? (
                  <>
                    <p className="text-sm font-bold text-ink">
                      Backup codes (shown once — save them now):
                    </p>
                    <ul
                      data-testid="backup-codes"
                      className="grid grid-cols-2 gap-1 font-mono text-xs text-ink-soft"
                    >
                      {backupCodes.map((code) => (
                        <li key={code}>{code}</li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {twoFactorEnabled ? (
                  <p className="text-sm font-bold text-success-ink">
                    Two-factor authentication is enabled.
                  </p>
                ) : (
                  <div className="space-y-1">
                    <label className={LABEL} htmlFor="totp-code">
                      Verification code
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="totp-code"
                        value={twoFactorCode}
                        inputMode="numeric"
                        onChange={(event) => setTwoFactorCode(event.target.value)}
                        className={cn(FIELD, "w-32")}
                      />
                      <Button
                        variant="primary"
                        onClick={verifyTwoFactor}
                        disabled={twoFactorCode.trim().length < 6}
                      >
                        Verify and enable
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
