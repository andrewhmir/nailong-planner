/**
 * Wheel-to-navigate gesture maths for the calendar grid (Google Calendar's
 * scroll-one-period behaviour). Kept pure so the gesture gate is unit-tested;
 * `CalendarShell` owns the event listener and the FullCalendar call.
 */

export const WHEEL_NAV_COOLDOWN_MS = 500;

/**
 * Trackpads emit a stream of small deltas; a mouse wheel sends one large delta.
 * Accumulate until the gesture is deliberate, then navigate once.
 */
export const WHEEL_NAV_THRESHOLD = 40;

/** -1 = previous period, 1 = next period, 0 = not a navigation gesture. */
export type WheelNavDirection = -1 | 0 | 1;

export interface WheelGesture {
  deltaX: number;
  deltaY: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface WheelStep {
  /** Delta carried into the next wheel event of the same gesture. */
  accumulator: number;
  direction: WheelNavDirection;
}

/**
 * Feed one wheel event into the gesture accumulator. A gesture that crosses the
 * threshold yields a direction and resets the accumulator, so one flick moves
 * exactly one period. Pinch-zoom (ctrl/meta) and horizontal swipes are ignored.
 */
export function stepWheel(accumulator: number, gesture: WheelGesture): WheelStep {
  if (gesture.ctrlKey || gesture.metaKey) {
    return { accumulator: 0, direction: 0 };
  }
  if (Math.abs(gesture.deltaX) > Math.abs(gesture.deltaY)) {
    return { accumulator: 0, direction: 0 };
  }
  const next = accumulator + gesture.deltaY;
  if (Math.abs(next) < WHEEL_NAV_THRESHOLD) {
    return { accumulator: next, direction: 0 };
  }
  return { accumulator: 0, direction: next > 0 ? 1 : -1 };
}

/** One navigation per gesture: ignore wheel events inside the cooldown window. */
export function wheelNavAllowed(lastNavigatedAt: number, now: number): boolean {
  return now - lastNavigatedAt >= WHEEL_NAV_COOLDOWN_MS;
}
