import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/lib/api/route";
import { AppError } from "@/lib/errors";

const URL = "http://localhost:3000/api/events";

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request(URL, { method, headers });
}

/**
 * Cookie-authenticated writes must come from this origin. SameSite=Lax alone is
 * not enough: on Railway's default *.up.railway.app domain a sibling tenant is
 * the same site, so its pages would otherwise carry the session cookie.
 */
describe("assertSameOrigin", () => {
  it("allows a same-origin browser write", () => {
    expect(() => assertSameOrigin(request("POST", { origin: "http://localhost:3000" }))).not.toThrow();
  });

  it("allows callers that send no Origin header", () => {
    expect(() => assertSameOrigin(request("POST"))).not.toThrow();
  });

  it("rejects a foreign Origin", () => {
    expect(() => assertSameOrigin(request("POST", { origin: "https://evil.example" }))).toThrow(
      AppError,
    );
  });

  it("rejects cross-site fetch metadata even without an Origin", () => {
    expect(() =>
      assertSameOrigin(request("PATCH", { "sec-fetch-site": "cross-site" })),
    ).toThrow(AppError);
  });

  it("does not restrict reads", () => {
    expect(() =>
      assertSameOrigin(request("GET", { origin: "https://evil.example" })),
    ).not.toThrow();
  });
});
