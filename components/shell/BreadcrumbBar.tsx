"use client";

import { useState } from "react";
import { SearchBox } from "@/components/calendar/SearchBox";
import { PersonPills } from "@/components/sidebar/PersonPills";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChevronRightIcon, MenuIcon, SearchIcon } from "@/components/ui/icons";
import type { TimeFormat } from "@/lib/services/preferences";
import type { VisibilityApi } from "@/lib/ui/useVisibility";

interface Props {
  /** The breadcrumb ancestor: the household the current page belongs to. */
  householdName: string;
  crumb: string;
  visibility: VisibilityApi;
  me: string;
  partner: string;
  timezone: string;
  timeFormat: TimeFormat;
  onOpenSidebar: () => void;
}

export function BreadcrumbBar({
  householdName,
  crumb,
  visibility,
  me,
  partner,
  timezone,
  timeFormat,
  onOpenSidebar,
}: Props) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <>
      <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line bg-surface safe-x">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open collections"
          onClick={onOpenSidebar}
          className="hidden shrink-0 md:inline-flex lg:hidden"
        >
          <MenuIcon size={20} />
        </Button>

        <div className="flex min-w-0 items-center gap-1.5">
          <span
            data-testid="breadcrumb-household"
            title={householdName}
            className="hidden min-w-0 max-w-[40ch] truncate text-sm text-ink-soft sm:block"
          >
            {householdName}
          </span>
          <ChevronRightIcon size={12} className="hidden shrink-0 text-ink-mute sm:block" />
          <span
            data-testid="breadcrumb-crumb"
            className="min-w-0 truncate text-[18px] leading-tight text-ink"
          >
            {crumb}
          </span>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {/* Wide enough for the field; narrower screens use the icon + dialog. */}
          <div className="hidden lg:block">
            <SearchBox timezone={timezone} timeFormat={timeFormat} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Search"
            className="shrink-0 lg:hidden"
            onClick={() => setMobileSearchOpen(true)}
          >
            <SearchIcon size={18} />
          </Button>
          {/* The pills need ~215px; below 360px the crumb and toggles need the room. */}
          <div className="hidden shrink-0 min-[360px]:block">
            <PersonPills visibility={visibility} me={me} partner={partner} />
          </div>
        </div>
      </header>

      {mobileSearchOpen ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setMobileSearchOpen(false);
            }
          }}
        >
          <DialogContent title="Search">
            <SearchBox
              timezone={timezone}
              timeFormat={timeFormat}
              inline
              autoFocus
              onNavigate={() => setMobileSearchOpen(false)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
