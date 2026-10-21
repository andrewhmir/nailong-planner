import type { PlannerView } from "@/components/calendar/Toolbar";
import type { DefaultView } from "@/lib/services/preferences";

/**
 * Which view a device starts on. `auto` is the spec's phone/desktop split: the
 * agenda is the readable landing view on a narrow screen, the month grid
 * everywhere else.
 */
export function resolveInitialView(defaultView: DefaultView, narrow: boolean): PlannerView {
  if (defaultView === "auto") {
    return narrow ? "listMonth" : "dayGridMonth";
  }
  return defaultView;
}
