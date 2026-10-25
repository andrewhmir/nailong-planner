"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { CollectionTree } from "@/components/sidebar/CollectionTree";
import { SidebarMiniMonth } from "@/components/sidebar/SidebarMiniMonth";
import { Button } from "@/components/ui/button";
import { MenuIcon } from "@/components/ui/icons";
import { LIVE_ENTRIES, ROADMAP, gateLabel, type RoadmapEntry } from "@/lib/roadmap";
import type { UserPreferences } from "@/lib/services/preferences";
import { useTreeFold } from "@/lib/ui/useTreeFold";
import { useVisibility } from "@/lib/ui/useVisibility";
import { Brand } from "./Brand";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { ComingSoonDialog } from "./ComingSoonDialog";
import { GlobalCapture } from "./GlobalCapture";
import { GlobalNavRail } from "./GlobalNavRail";
import { VisibilityProvider } from "./VisibilityProvider";

export interface MemberSummary {
  id: string;
  name: string;
  isSelf: boolean;
}

interface Props {
  currentUser: { id: string; name: string };
  members: MemberSummary[];
  householdName: string;
  timezone: string;
  /** The current user's server snapshot; `timeFormat` and global capture read it. */
  preferences: UserPreferences;
  children: React.ReactNode;
}

/**
 * The crumb belongs to the page, but the layout that renders AppShell owns the
 * shell, so no page can pass props down. Route-derived is therefore the only
 * mechanism: add a roadmap entry with `status: "live"` when a page ships.
 */
const ROUTE_CRUMBS: Record<string, string> = Object.fromEntries(
  LIVE_ENTRIES.map((entry) => [entry.href, entry.label]),
);

/** Any unlisted `(app)` route falls back to the app's home label. */
const FALLBACK_CRUMB = "Calendar";

export function AppShell({
  currentUser,
  members,
  householdName,
  timezone,
  preferences,
  children,
}: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [comingSoon, setComingSoon] = useState<RoadmapEntry | null>(null);
  /** The control that opened the gated dialog, so focus can return to it. */
  const comingSoonTrigger = useRef<HTMLElement | null>(null);
  const visibility = useVisibility(currentUser.id);
  const fold = useTreeFold(currentUser.id);
  const partnerName = members.find((member) => !member.isSelf)?.name ?? "Partner";
  const activeCrumb = ROUTE_CRUMBS[pathname] ?? FALLBACK_CRUMB;

  function openComingSoon(entry: RoadmapEntry, trigger: HTMLElement) {
    comingSoonTrigger.current = trigger;
    setComingSoon(entry);
  }

  function closeComingSoon() {
    const trigger = comingSoonTrigger.current;
    comingSoonTrigger.current = null;
    setComingSoon(null);
    // The dialog unmounts on the next paint; return focus after that.
    window.setTimeout(() => {
      if (trigger && trigger.isConnected) {
        trigger.focus();
      }
    }, 0);
  }

  const tree = (
    <CollectionTree
      visibility={visibility}
      fold={fold}
      currentUserId={currentUser.id}
      currentUserName={currentUser.name}
      partnerName={partnerName}
    />
  );

  return (
    <VisibilityProvider value={visibility}>
      {/* The shell is a fixed viewport frame: `h-dvh` matches the visible screen
          on phones (the old `min-h-screen` let the page grow), and
          `overflow-hidden` means the document itself can never scroll. The rail
          and breadcrumb bar therefore stay put, and anything that genuinely
          overflows scrolls inside `main` instead of moving the page. */}
      <div className="flex h-dvh flex-col overflow-hidden text-ink md:flex-row">
        <GlobalNavRail
          householdName={householdName}
          currentUser={currentUser}
          onComingSoon={openComingSoon}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Phone: the rail becomes a 56px dark top bar. */}
          <div className="flex h-14 shrink-0 items-center gap-2 bg-rail px-3 text-white md:hidden">
            <Brand name="Nailong Planner" showName />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open collections"
              onClick={() => setSidebarOpen(true)}
              className="ml-auto shrink-0 text-white hover:bg-rail-hover focus-visible:outline-white"
            >
              <MenuIcon size={20} />
            </Button>
          </div>

          {/* The shell's page heading for routes whose page does not render one.
              It is visually hidden because the shell has no visible title. A
              page that renders its own h1 (settings) therefore has a second
              one by design, not by accident. */}
          <h1 className="sr-only">Nailong Planner</h1>

          <BreadcrumbBar
            householdName={householdName}
            crumb={activeCrumb}
            visibility={visibility}
            me={currentUser.name}
            partner={partnerName}
            timezone={timezone}
            timeFormat={preferences.timeFormat}
            onOpenSidebar={() => setSidebarOpen(true)}
          />

          <div className="flex min-h-0 flex-1">
            <aside className="hidden min-h-0 w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
              <div className="shrink-0 overflow-y-auto">
                <SidebarMiniMonth currentUserId={currentUser.id} timezone={timezone} />
              </div>
              <nav
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                aria-label="Collection tree"
              >
                {tree}
              </nav>
            </aside>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain bg-surface p-3 sm:p-6">
              {children}
            </main>
          </div>
        </div>

        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close collections"
              className="absolute inset-0 bg-scrim"
              onClick={() => setSidebarOpen(false)}
            />
            <div
              role="dialog"
              aria-label="Collections"
              className="absolute inset-x-0 bottom-0 flex max-h-[75vh] flex-col overflow-y-auto rounded-t-md border border-line bg-surface p-4 shadow-dialog md:inset-y-[72px] md:right-auto md:w-56 md:rounded-md md:border-r md:shadow-menu"
            >
              <div className="flex items-center justify-between">
                <span className="px-2 text-sm font-bold text-ink">Go to</span>
                <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                  Close
                </Button>
              </div>
              <nav aria-label="Destinations" className="mb-2 flex flex-col">
                {ROADMAP.map((entry) =>
                  entry.status === "live" ? (
                    <Link
                      key={entry.id}
                      href={entry.href}
                      className="rounded-sm px-2 py-1 text-sm text-link hover:bg-well"
                      onClick={() => setSidebarOpen(false)}
                    >
                      {entry.label}
                    </Link>
                  ) : (
                    <button
                      key={entry.id}
                      type="button"
                      aria-label={`${entry.label} — ${gateLabel(entry)}`}
                      aria-haspopup="dialog"
                      onClick={(event) => openComingSoon(entry, event.currentTarget)}
                      className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm text-ink hover:bg-well"
                    >
                      <span>{entry.label}</span>
                      <span className="text-xs text-ink-mute">{gateLabel(entry)}</span>
                    </button>
                  ),
                )}
              </nav>
              <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Collection tree">
                <SidebarMiniMonth currentUserId={currentUser.id} timezone={timezone} />
                {tree}
              </nav>
            </div>
          </div>
        ) : null}

        <ComingSoonDialog entry={comingSoon} onClose={closeComingSoon} />
        <GlobalCapture initialPreferences={preferences} />
      </div>
    </VisibilityProvider>
  );
}
