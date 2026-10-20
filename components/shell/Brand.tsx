import { cn } from "@/lib/utils";

interface Props {
  name: string;
  /** Show the name beside the tile (the phone top bar); the 54px rail has no room. */
  showName?: boolean;
  testId?: string;
  className?: string;
}

/** The household logomark: a 32px white tile carrying the name's initial. */
export function Brand({ name, showName = false, testId, className }: Props) {
  const initial = name.trim().charAt(0).toUpperCase() || "N";

  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        data-testid={testId}
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white text-lg font-bold leading-none text-rail"
      >
        {initial}
      </span>
      {showName ? (
        <span className="min-w-0 truncate text-base font-bold leading-tight text-white">{name}</span>
      ) : null}
    </span>
  );
}
