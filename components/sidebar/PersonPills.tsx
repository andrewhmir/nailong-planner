"use client";

import type { GroupKey } from "@/lib/ui/visibility";
import type { VisibilityApi } from "@/lib/ui/useVisibility";
import { cn } from "@/lib/utils";

interface Props {
  visibility: VisibilityApi;
  me: string;
  partner: string;
}

export function PersonPills({ visibility, me, partner }: Props) {
  const pills: Array<{ group: GroupKey; label: string }> = [
    { group: "ours", label: "Ours" },
    { group: "me", label: me },
    { group: "partner", label: partner },
  ];

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Cross-check calendars">
      {pills.map(({ group, label }) => {
        const on = visibility.state.groups[group];
        return (
          <button
            key={group}
            type="button"
            aria-pressed={on}
            onClick={() => visibility.setGroup(group, !on)}
            className={cn(
              "h-6 rounded-pill border border-line-strong px-2 text-sm font-normal transition-colors duration-200",
              on ? "bg-surface text-ink hover:bg-well" : "bg-well text-ink-soft hover:text-ink",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
