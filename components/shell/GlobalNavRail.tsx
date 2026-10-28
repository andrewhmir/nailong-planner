"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarIcon,
  FocusIcon,
  NotesIcon,
  SettingsIcon,
  TasksIcon,
  TodayIcon,
  type IconProps,
} from "@/components/ui/icons";
import { ROADMAP, gateLabel, type RoadmapEntry, type RoadmapId } from "@/lib/roadmap";
import { cn } from "@/lib/utils";
import { Brand } from "./Brand";

interface Props {
  householdName: string;
  currentUser: { id: string; name: string };
  /** Opens the shared "what's coming" dialog for a gated destination. */
  onComingSoon: (entry: RoadmapEntry, trigger: HTMLElement) => void;
}

// Canvas's rail ring: white for the dark tile, plus a gray inner edge so the
// ring stays visible on the white active tile.
const RAIL_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white focus-visible:shadow-[inset_0_0_0_2px_var(--color-ink-mute),inset_0_0_0_4px_#ffffff]";

const RAIL_ITEM = `grid h-12 w-[54px] place-items-center transition-colors duration-200 ${RAIL_FOCUS}`;

const ICONS: Readonly<Record<RoadmapId, (props: IconProps) => React.ReactElement>> = {
  calendar: CalendarIcon,
  tasks: TasksIcon,
  today: TodayIcon,
  notes: NotesIcon,
  focus: FocusIcon,
  settings: SettingsIcon,
};

/** Dark presentation tooltip; hover and focus both reveal it. */
function RailTooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-1 -translate-y-1/2 whitespace-nowrap rounded-sm bg-rail-hover px-1.5 py-1 text-sm text-white opacity-0 shadow-menu transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      {label}
    </span>
  );
}

interface EntryProps {
  entry: RoadmapEntry;
  active: boolean;
  onComingSoon: Props["onComingSoon"];
}

function RailEntry({ entry, active, onComingSoon }: EntryProps) {
  const Icon = ICONS[entry.id];

  if (entry.status === "planned") {
    const label = `${entry.label} — ${gateLabel(entry)}`;
    return (
      <div className="group relative w-full">
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={(event) => onComingSoon(entry, event.currentTarget)}
          className={cn(RAIL_ITEM, "text-white/40 hover:bg-rail-hover hover:text-white/75")}
        >
          <Icon size={26} />
        </button>
        <RailTooltip label={label} />
      </div>
    );
  }

  return (
    <div className="group relative w-full">
      <Link
        href={entry.href}
        aria-label={entry.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          RAIL_ITEM,
          active ? "bg-rail-active-bg text-accent" : "text-white hover:bg-rail-hover",
        )}
      >
        <Icon size={26} />
      </Link>
      <RailTooltip label={entry.label} />
    </div>
  );
}

export function GlobalNavRail({ householdName, currentUser, onComingSoon }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const settings = ROADMAP.find((entry) => entry.id === "settings");
  const destinations = ROADMAP.filter((entry) => entry.id !== "settings");
  const initial = currentUser.name.trim().charAt(0).toUpperCase() || "?";

  function isActive(entry: RoadmapEntry): boolean {
    if (entry.href === "/") {
      return pathname === "/";
    }
    return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
  }

  async function signOut() {
    if (signingOut) {
      return;
    }
    setSigningOut(true);

    let signedOut = false;
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      signedOut = response.ok;
    } catch {
      signedOut = false;
    }

    if (!signedOut) {
      setSigningOut(false);
      toast.error("Could not sign out. Try again.");
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <nav
      aria-label="Primary navigation"
      className="hidden w-[calc(54px_+_var(--safe-left))] shrink-0 flex-col items-center bg-rail py-2 pl-[var(--safe-left)] md:flex"
    >
      <Link
        href="/"
        aria-label={householdName}
        title={householdName}
        className={`mb-2 block max-w-full rounded-md ${RAIL_FOCUS}`}
      >
        <Brand name={householdName} testId="rail-logomark" />
      </Link>

      {destinations.map((entry) => (
        <RailEntry
          key={entry.id}
          entry={entry}
          active={isActive(entry)}
          onComingSoon={onComingSoon}
        />
      ))}

      {settings ? (
        <div className="mt-auto w-full pt-2">
          <RailEntry entry={settings} active={isActive(settings)} onComingSoon={onComingSoon} />
        </div>
      ) : null}

      <div className="pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={signingOut}
              aria-label={`Account menu for ${currentUser.name}`}
              className={`grid h-[30px] w-[30px] place-items-center rounded-pill border-2 border-white bg-rail-hover text-xs font-bold text-white transition-colors duration-200 hover:bg-rail disabled:opacity-50 ${RAIL_FOCUS}`}
            >
              {initial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{currentUser.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              onSelect={(event) => {
                // Keep the menu mounted so the item's pending state is visible.
                event.preventDefault();
                void signOut();
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
