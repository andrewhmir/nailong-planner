import { describe, expect, it } from "vitest";
import {
  WHEEL_NAV_COOLDOWN_MS,
  WHEEL_NAV_THRESHOLD,
  stepWheel,
  wheelNavAllowed,
} from "@/lib/ui/wheelNav";

describe("stepWheel", () => {
  it("navigates on a mouse-wheel-sized delta in each direction", () => {
    expect(stepWheel(0, { deltaX: 0, deltaY: 120 })).toEqual({
      accumulator: 0,
      direction: 1,
    });
    expect(stepWheel(0, { deltaX: 0, deltaY: -120 })).toEqual({
      accumulator: 0,
      direction: -1,
    });
  });

  it("accumulates trackpad-sized deltas into one step", () => {
    let state = { accumulator: 0, direction: 0 as -1 | 0 | 1 };
    for (let i = 0; i < 3; i += 1) {
      state = stepWheel(state.accumulator, { deltaX: 0, deltaY: 10 });
      expect(state.direction).toBe(0);
    }
    expect(state.accumulator).toBe(30);
    // The fourth 10 completes the 40 threshold: the gesture navigates once.
    state = stepWheel(state.accumulator, { deltaX: 0, deltaY: 10 });
    expect(state).toEqual({ accumulator: 0, direction: 1 });
  });

  it("ignores horizontal swipes", () => {
    expect(stepWheel(0, { deltaX: 120, deltaY: 10 })).toEqual({
      accumulator: 0,
      direction: 0,
    });
  });

  it("ignores pinch-zoom / browser zoom (ctrl or meta)", () => {
    expect(stepWheel(30, { deltaX: 0, deltaY: 300, ctrlKey: true })).toEqual({
      accumulator: 0,
      direction: 0,
    });
    expect(stepWheel(30, { deltaX: 0, deltaY: 300, metaKey: true })).toEqual({
      accumulator: 0,
      direction: 0,
    });
  });

  it("keeps the sign of a negative gesture that crosses the threshold", () => {
    expect(stepWheel(-30, { deltaX: 0, deltaY: -15 })).toEqual({
      accumulator: 0,
      direction: -1,
    });
    expect(WHEEL_NAV_THRESHOLD).toBe(40);
  });
});

describe("wheelNavAllowed", () => {
  it("allows the first gesture and one step per cooldown window", () => {
    expect(wheelNavAllowed(0, 1000)).toBe(true);
    expect(wheelNavAllowed(1000, 1000 + WHEEL_NAV_COOLDOWN_MS - 1)).toBe(false);
    expect(wheelNavAllowed(1000, 1000 + WHEEL_NAV_COOLDOWN_MS)).toBe(true);
  });
});
