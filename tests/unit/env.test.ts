import { describe, expect, it, vi } from "vitest";
import { assertProductionEnv } from "@/lib/env";

const complete = {
  NODE_ENV: "production",
  DATABASE_URL: "file:/data/planner.db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://planner.example.com",
};

describe("assertProductionEnv", () => {
  it("does nothing outside production", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertProductionEnv({ NODE_ENV: "development" })).not.toThrow();
  });

  it("accepts a complete production environment", () => {
    expect(() => assertProductionEnv(complete)).not.toThrow();
  });

  it("rejects a missing BETTER_AUTH_SECRET", () => {
    expect(() => assertProductionEnv({ ...complete, BETTER_AUTH_SECRET: undefined })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects a short BETTER_AUTH_SECRET", () => {
    expect(() => assertProductionEnv({ ...complete, BETTER_AUTH_SECRET: "too-short" })).toThrow(
      /at least 32 characters/,
    );
  });

  it("rejects an implicit DATABASE_URL", () => {
    expect(() => assertProductionEnv({ ...complete, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("rejects a non-absolute BETTER_AUTH_URL", () => {
    expect(() => assertProductionEnv({ ...complete, BETTER_AUTH_URL: "planner.example.com" })).toThrow(
      /absolute URL/,
    );
  });

  it("warns instead of failing on an http or localhost origin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        assertProductionEnv({ ...complete, BETTER_AUTH_URL: "http://localhost:3000" }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
