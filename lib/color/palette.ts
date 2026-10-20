/**
 * The single source of truth for calendar colors.
 *
 * Every hue family is defined by one OKLCH hue + chroma pair, so all eight
 * shades of a family keep the same perceptual hue while stepping through a
 * fixed lightness ramp. The parent calendar renders at `PARENT_SHADE_INDEX`;
 * sub-calendars are assigned the next unused step from `CHILD_SHADE_ORDER`.
 */

export const HUE_FAMILIES = [
  "teal",
  "green",
  "lime",
  "amber",
  "orange",
  "rose",
  "violet",
  "indigo",
  "sky",
  "slate",
] as const;

export type HueFamily = (typeof HUE_FAMILIES)[number];

const FAMILIES: Record<HueFamily, { hue: number; chroma: number }> = {
  teal: { hue: 190, chroma: 0.09 },
  green: { hue: 150, chroma: 0.1 },
  lime: { hue: 125, chroma: 0.12 },
  amber: { hue: 85, chroma: 0.13 },
  orange: { hue: 55, chroma: 0.14 },
  rose: { hue: 10, chroma: 0.12 },
  violet: { hue: 310, chroma: 0.12 },
  indigo: { hue: 275, chroma: 0.13 },
  sky: { hue: 235, chroma: 0.1 },
  slate: { hue: 250, chroma: 0.02 },
};

export const SHADE_COUNT = 8;

/** The shade a top-level calendar renders at. */
export const PARENT_SHADE_INDEX = 3;

/** Order in which sub-calendars claim the remaining shades. */
export const CHILD_SHADE_ORDER = [4, 2, 5, 1, 6, 0, 7] as const;

/** Maximum number of sub-calendars under one top-level calendar. */
export const MAX_CHILDREN = CHILD_SHADE_ORDER.length;

const MAIN_LIGHTNESS = [0.86, 0.79, 0.72, 0.65, 0.58, 0.51, 0.44, 0.37] as const;

/** Event blocks are lighter than their dot so text stays readable. */
const CONTAINER_LIFT = 0.17;
const CONTAINER_CHROMA_FACTOR = 0.55;

const DARK_TEXT = "#273540";
const LIGHT_TEXT = "#ffffff";
const LIGHT_TEXT_THRESHOLD = 0.62;

/** Every container stays light enough for ink text to clear 4.5:1. */
const CONTAINER_LIGHTNESS_FLOOR = 0.7;

export interface ShadeTokens {
  /** Saturated accent: dots, borders, drag highlights. */
  main: string;
  /** Same color as hex — FullCalendar's color parser only understands sRGB. */
  mainHex: string;
  /** Soft fill behind event titles. */
  container: string;
  /** Same color as hex, for FullCalendar. */
  containerHex: string;
  /** Text color that sits on `container`. */
  onContainer: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Converts an OKLCH triplet to sRGB hex. */
function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const encoded = linear.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const gamma =
      clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255)
      .toString(16)
      .padStart(2, "0");
  });

  return `#${encoded.join("")}`;
}

export function shadeTokens(family: HueFamily, shadeIndex: number): ShadeTokens {
  if (!Number.isInteger(shadeIndex) || shadeIndex < 0 || shadeIndex >= SHADE_COUNT) {
    throw new RangeError(`shadeIndex must be an integer between 0 and ${SHADE_COUNT - 1}`);
  }

  const { hue, chroma } = FAMILIES[family];
  const lightness = MAIN_LIGHTNESS[shadeIndex]!;
  const containerLightness = round2(
    Math.min(0.97, Math.max(CONTAINER_LIGHTNESS_FLOOR, lightness + CONTAINER_LIFT)),
  );
  const containerChroma = round2(chroma * CONTAINER_CHROMA_FACTOR);

  return {
    main: `oklch(${lightness.toFixed(2)} ${chroma.toFixed(2)} ${hue})`,
    mainHex: oklchToHex(lightness, chroma, hue),
    container: `oklch(${containerLightness.toFixed(2)} ${containerChroma.toFixed(2)} ${hue})`,
    containerHex: oklchToHex(containerLightness, containerChroma, hue),
    onContainer: containerLightness < LIGHT_TEXT_THRESHOLD ? LIGHT_TEXT : DARK_TEXT,
  };
}

export function isHueFamily(value: string): value is HueFamily {
  return (HUE_FAMILIES as readonly string[]).includes(value);
}
