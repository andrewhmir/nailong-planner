import { describe, expect, it } from "vitest";
import {
  CHILD_SHADE_ORDER,
  HUE_FAMILIES,
  MAX_CHILDREN,
  SHADE_COUNT,
  isHueFamily,
  shadeTokens,
} from "@/lib/color/palette";

const linear = (hex: string, offset: number) => {
  const v = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * linear(hex, 1) + 0.7152 * linear(hex, 3) + 0.0722 * linear(hex, 5);
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("palette", () => {
  it("exposes 8 distinct main shades per family", () => {
    for (const family of HUE_FAMILIES) {
      const mains = Array.from({ length: SHADE_COUNT }, (_, i) => shadeTokens(family, i).main);
      expect(new Set(mains).size).toBe(SHADE_COUNT);
    }
  });

  it("pins the parent shade and the child order", () => {
    expect(shadeTokens("teal", 3).main).toBe("oklch(0.65 0.09 190)");
    expect(CHILD_SHADE_ORDER).toEqual([4, 2, 5, 1, 6, 0, 7]);
    expect(MAX_CHILDREN).toBe(7);
  });

  it("exposes sRGB hex twins for FullCalendar's color parser", () => {
    for (const family of HUE_FAMILIES) {
      const tokens = shadeTokens(family, 3);
      expect(tokens.mainHex).toMatch(/^#[0-9a-f]{6}$/);
      expect(tokens.containerHex).toMatch(/^#[0-9a-f]{6}$/);
      expect(tokens.mainHex).not.toBe(tokens.containerHex);
    }
    expect(shadeTokens("teal", 3).mainHex).toBe("#40a19b");
  });

  it("uses Canvas ink on every container", () => {
    expect(shadeTokens("rose", 0).onContainer).toBe("#273540");
    expect(shadeTokens("rose", 7).onContainer).toBe("#273540");
  });

  it("keeps every container pale enough for ink at 4.5:1", () => {
    for (const family of HUE_FAMILIES) {
      for (let shade = 0; shade < SHADE_COUNT; shade += 1) {
        const tokens = shadeTokens(family, shade);
        expect(tokens.onContainer).toBe("#273540");
        expect(ratio(tokens.containerHex, tokens.onContainer)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("floors container lightness so the darkest shades stay legible", () => {
    expect(shadeTokens("teal", 7).container).toBe("oklch(0.70 0.05 190)");
    expect(shadeTokens("teal", 0).container).toBe("oklch(0.97 0.05 190)");
  });

  it("narrows hue family strings", () => {
    expect(isHueFamily("teal")).toBe(true);
    expect(isHueFamily("blue")).toBe(false);
  });
});
