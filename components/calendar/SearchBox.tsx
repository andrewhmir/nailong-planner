"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon } from "@/components/ui/icons";
import { navigableDateFor, useSearchEvents } from "@/lib/query/search";
import type { EventView } from "@/lib/services/events";
import type { TimeFormat } from "@/lib/services/preferences";
import { useDebouncedValue } from "@/lib/ui/useDebouncedValue";
import { onFocusSearch, announceEventLink } from "@/lib/ui/searchBus";
import { SearchResultsOverlay } from "./SearchResultsOverlay";

interface Props {
  timezone: string;
  timeFormat: TimeFormat;
  /** Inside the phone dialog the results panel sits in normal flow. */
  inline?: boolean;
  /** Focus the field as soon as it mounts (phone dialog). */
  autoFocus?: boolean;
  onNavigate?: () => void;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

/**
 * Header search: combobox over the household-wide event search. Result rows
 * navigate with `/?date=…&event=…`; the calendar shell owns the deep link, so
 * this component never needs a callback into the grid.
 */
export function SearchBox({ timezone, timeFormat, inline = false, autoFocus = false, onNavigate }: Props) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounced = useDebouncedValue(query, 150);
  const { data: results, isFetching } = useSearchEvents(debounced);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const rows = results ?? [];
  // Clamp instead of resetting in an effect: a shorter result list must never
  // leave the active row pointing past the end.
  const activeRow = rows.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), rows.length - 1);

  useEffect(() => onFocusSearch(() => inputRef.current?.focus()), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isTextEntryTarget(event.target)) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function choose(event: EventView): void {
    const date = navigableDateFor(event, timezone);
    setOpen(false);
    setQuery("");
    onNavigate?.();
    // Announce before navigating: the shell needs the click time, not the time
    // the router finally exposes `?date=…&event=…`.
    announceEventLink({ date, eventId: event.id });
    router.push(`/?date=${date}&event=${event.id}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(Math.min(activeRow + 1, rows.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(activeRow - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const target = rows[activeRow] ?? rows[0];
      if (target) {
        event.preventDefault();
        choose(target);
      }
      return;
    }
    if (event.key === "Escape") {
      if (query.length > 0) {
        setQuery("");
        return;
      }
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className={inline ? "relative w-full" : "relative"}>
      <div className="flex h-[38px] w-full items-center gap-2 rounded-md border border-field bg-surface px-3 focus-within:border-accent">
        <SearchIcon size={16} className="shrink-0 text-ink-soft" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search events"
          placeholder="Search events"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow >= 0 ? `${listId}-${activeRow}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`${inline ? "w-full" : "w-40 xl:w-56"} bg-transparent text-sm text-ink outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden`}
        />
        {query.length === 0 ? (
          <kbd
            aria-hidden
            className="shrink-0 rounded-sm border border-line-strong px-1.5 text-xs text-ink-soft"
          >
            /
          </kbd>
        ) : null}
      </div>

      {open ? (
        <div className={inline ? undefined : "w-[26rem] max-w-[calc(100vw-2rem)]"}>
          <SearchResultsOverlay
            id={listId}
            query={debounced}
            results={results}
            isFetching={isFetching}
            activeIndex={activeRow}
            timezone={timezone}
            timeFormat={timeFormat}
            inline={inline}
            onSelect={choose}
            onActiveIndexChange={setActiveIndex}
          />
        </div>
      ) : null}
    </div>
  );
}
