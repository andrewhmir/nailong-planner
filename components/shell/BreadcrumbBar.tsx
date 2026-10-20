"use client";

import { PersonPills } from "@/components/sidebar/PersonPills";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon, MenuIcon } from "@/components/ui/icons";
import type { VisibilityApi } from "@/lib/ui/useVisibility";

interface Props {
  /** The breadcrumb ancestor: the household the current page belongs to. */
  householdName: string;
  crumb: string;
  visibility: VisibilityApi;
  me: string;
  partner: string;
  onOpenSidebar: () => void;
}

export function BreadcrumbBar({
  householdName,
  crumb,
  visibility,
  me,
  partner,
  onOpenSidebar,
}: Props) {
  return (
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-6">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Open calendars"
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

      {/* The pills need ~215px; below 360px the crumb and toggle need the room. */}
      <div className="ml-auto hidden shrink-0 min-[360px]:block">
        <PersonPills visibility={visibility} me={me} partner={partner} />
      </div>
    </header>
  );
}
