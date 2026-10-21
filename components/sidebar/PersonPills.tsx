"use client";

import { Button } from "@/components/ui/button";
import type { GroupKey } from "@/lib/ui/visibility";
import type { VisibilityApi } from "@/lib/ui/useVisibility";

interface Props {
  visibility: VisibilityApi;
  me: string;
  partner: string;
}

/**
 * Cross-check visibility toggles for the three calendar groups.
 *
 * Rendered with the shared `Button size="sm"` so they share the shell's boxy
 * language (28px tall, 4px radius, 1px #d7dade) with the search/menu icon
 * buttons beside them. "On" is the outline variant's grey fill; "off" drops to
 * the plain surface so the pressed groups read as filled chips.
 */
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
          <Button
            key={group}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={on}
            onClick={() => visibility.setGroup(group, !on)}
            className={on ? undefined : "bg-surface text-ink-soft hover:bg-well hover:text-ink"}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
