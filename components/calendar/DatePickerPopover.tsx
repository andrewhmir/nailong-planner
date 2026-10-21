"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MiniMonth } from "./MiniMonth";

interface Props {
  anchorDate: string;
  selectedDate?: string;
  eventDates?: ReadonlySet<string>;
  onPick: (date: string) => void;
}

/** Popover body for the toolbar title: a mini-month plus a Today shortcut. */
export function DatePickerPopover({ anchorDate, selectedDate, eventDates, onPick }: Props) {
  const [anchor, setAnchor] = useState(anchorDate);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="w-64">
      <MiniMonth
        anchorDate={anchor}
        selectedDate={selectedDate}
        eventDates={eventDates}
        onAnchorChange={setAnchor}
        onSelectDate={onPick}
      />
      <div className="mt-2 flex justify-end border-t border-line pt-2">
        <Button size="sm" onClick={() => onPick(today)}>
          Today
        </Button>
      </div>
    </div>
  );
}
