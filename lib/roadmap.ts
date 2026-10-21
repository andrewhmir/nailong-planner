/**
 * The rail's destinations and the product roadmap behind them.
 *
 * One list drives the rail, the mobile drawer, the breadcrumb map and the
 * "what's coming" dialogs, so a release ceremony is a single `status` flip —
 * no version string is hand-written anywhere else.
 *
 * Version policy: only the next release is promised ("Coming in v0.2.0").
 * Everything after that says "Planned" until it has a version of its own.
 */

/** Must equal `version` in package.json; `tests/unit/roadmap.test.ts` enforces it. */
export const APP_VERSION = "0.1.0";

export type RoadmapStatus = "live" | "planned";

export type RoadmapId = "calendar" | "tasks" | "today" | "notes" | "focus" | "settings";

export interface RoadmapEntry {
  id: RoadmapId;
  /** Rail tooltip, dialog title and breadcrumb text. */
  label: string;
  href: string;
  status: RoadmapStatus;
  /** Only set on a promised release, e.g. "v0.2.0". */
  version?: string;
  /** One line: the promise, in the user's language. */
  blurb: string;
  /** What's coming, for the gated dialog. Empty for live destinations. */
  capabilities: string[];
}

/**
 * Order is the rail's order. Settings is listed last because the rail pins it
 * above the account menu instead of the main icon group.
 */
export const ROADMAP: readonly RoadmapEntry[] = [
  {
    id: "calendar",
    label: "Calendar",
    href: "/",
    status: "live",
    blurb: "Your calendars, together or separately.",
    capabilities: [],
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    status: "planned",
    version: "v0.2.0",
    blurb: "Everything you owe yourself, in one place.",
    capabilities: [
      "Capture anything with Shift+K, from any screen",
      "Triage in the morning: Today, This week or Someday",
      "Drag a task onto a day to make room for it",
      "Lists only you can see — and lists we share",
      "Move with j/k, file with 1–3, no mouse needed",
    ],
  },
  {
    id: "today",
    label: "Today",
    href: "/today",
    status: "planned",
    blurb: "One page for the day: what's next, what's left, what matters.",
    capabilities: [
      "Your agenda at a glance",
      "The three things that actually matter today",
      "A focus ring and a note that grows with the day",
      "When we are both free",
    ],
  },
  {
    id: "notes",
    label: "Notes",
    href: "/notes",
    status: "planned",
    blurb: "Write it down before it turns into a task.",
    capabilities: [
      "Markdown notes that stay out of your way",
      "Attach a note to an event or a task",
      "A daily note that grows with the day",
      "A shared space for ideas we want to keep",
    ],
  },
  {
    id: "focus",
    label: "Focus",
    href: "/focus",
    status: "planned",
    blurb: "A Pomodoro that knows what you're working on.",
    capabilities: [
      "Pomodoro presets that need no setup",
      "Start a session straight from a task",
      "Time logged against what you actually worked on",
      "Focus blocks that show on the calendar",
    ],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    status: "live",
    blurb: "Household, account and calendar preferences.",
    capabilities: [],
  },
];

/** "Coming in v0.2.0" for the next release; "Planned" for everything after. */
export function gateLabel(entry: Pick<RoadmapEntry, "version">): string {
  return entry.version ? `Coming in ${entry.version}` : "Planned";
}

/** Destinations reachable today — the breadcrumb map and nothing else needs these. */
export const LIVE_ENTRIES: readonly RoadmapEntry[] = ROADMAP.filter(
  (entry) => entry.status === "live",
);
