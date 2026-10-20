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
import { CalendarIcon, SettingsIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Brand } from "./Brand";

interface Props {
  householdName: string;
  currentUser: { id: string; name: string };
}

// Canvas's rail ring: white for the dark tile, plus a gray inner edge so the
// ring stays visible on the white active tile.
const RAIL_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white focus-visible:shadow-[inset_0_0_0_2px_var(--color-ink-mute),inset_0_0_0_4px_#ffffff]";

const RAIL_ITEM = `grid h-12 w-[54px] place-items-center transition-colors duration-200 ${RAIL_FOCUS}`;

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

export function GlobalNavRail({ householdName, currentUser }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const onCalendar = pathname === "/";
  const onSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const initial = currentUser.name.trim().charAt(0).toUpperCase() || "?";

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
      className="hidden w-[54px] shrink-0 flex-col items-center bg-rail py-2 md:flex"
    >
      <Link
        href="/"
        aria-label={householdName}
        title={householdName}
        className={`mb-2 block max-w-full rounded-md ${RAIL_FOCUS}`}
      >
        <Brand name={householdName} testId="rail-logomark" />
      </Link>

      <div className="group relative w-full">
        <Link
          href="/"
          aria-label="Calendar"
          aria-current={onCalendar ? "page" : undefined}
          className={cn(
            RAIL_ITEM,
            onCalendar ? "bg-rail-active-bg text-accent" : "text-white hover:bg-rail-hover",
          )}
        >
          <CalendarIcon size={26} />
        </Link>
        <RailTooltip label="Calendar" />
      </div>

      <div className="group relative w-full">
        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={onSettings ? "page" : undefined}
          className={cn(
            RAIL_ITEM,
            onSettings ? "bg-rail-active-bg text-accent" : "text-white hover:bg-rail-hover",
          )}
        >
          <SettingsIcon size={26} />
        </Link>
        <RailTooltip label="Settings" />
      </div>

      <div className="mt-auto pt-2">
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
