import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION, ROADMAP, gateLabel } from "@/lib/roadmap";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("roadmap", () => {
  it("reports the version in package.json", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("describes every rail destination exactly once", () => {
    const ids = ROADMAP.map((entry) => entry.id);
    const hrefs = ROADMAP.map((entry) => entry.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const entry of ROADMAP) {
      expect(entry.href.startsWith("/")).toBe(true);
      expect(entry.label.trim()).not.toBe("");
      expect(entry.blurb.trim()).not.toBe("");
    }
  });

  it("promises only the next version", () => {
    const promised = ROADMAP.filter((entry) => entry.status === "planned" && entry.version);
    expect(promised).toHaveLength(1);
    expect(promised[0]?.id).toBe("today");
    expect(promised[0]?.version).toBe("v0.4.0");
  });

  it("keeps Tasks live, with no version and no capabilities", () => {
    const tasks = ROADMAP.find((entry) => entry.id === "tasks");
    expect(tasks?.status).toBe("live");
    expect(tasks?.version).toBeUndefined();
    expect(tasks?.capabilities).toEqual([]);
  });

  it("gives every planned destination capabilities and the right gate label", () => {
    const planned = ROADMAP.filter((entry) => entry.status === "planned");
    expect(planned.length).toBeGreaterThan(0);
    for (const entry of planned) {
      expect(entry.capabilities.length).toBeGreaterThanOrEqual(2);
      expect(gateLabel(entry)).toBe(
        entry.version ? `Coming in ${entry.version}` : "Planned",
      );
    }
    expect(Object.fromEntries(planned.map((entry) => [entry.id, gateLabel(entry)]))).toEqual({
      today: "Coming in v0.4.0",
      notes: "Planned",
      focus: "Planned",
    });
  });

  it("keeps the live destinations at Calendar, Tasks and Settings", () => {
    expect(ROADMAP.filter((entry) => entry.status === "live").map((entry) => entry.href)).toEqual([
      "/",
      "/tasks",
      "/settings",
    ]);
  });
});
