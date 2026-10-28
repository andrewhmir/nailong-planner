import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE, requestJson } from "@/lib/query/request";

afterEach(() => vi.unstubAllGlobals());

describe("requestJson", () => {
  it("refuses to fetch while offline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestJson("/api/events")).rejects.toThrow(OFFLINE_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 })),
    );
    await expect(requestJson<{ events: unknown[] }>("/api/events")).resolves.toEqual({ events: [] });
  });

  it("surfaces the API error envelope", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Calendar not found." } }), {
            status: 404,
          }),
      ),
    );
    await expect(requestJson("/api/events/x")).rejects.toThrow("Calendar not found.");
  });
});
