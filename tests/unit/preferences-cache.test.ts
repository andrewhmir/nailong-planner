import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preferencesKey, useUpdatePreferences } from "@/lib/query/preferences";
import type { UserPreferences } from "@/lib/services/preferences";

/**
 * The preferences mutation only earns its "out-of-order safe" name if a stale
 * failure cannot roll the cache back past a newer PATCH. No DOM library is
 * installed, so the hook is mounted with `renderToString`, its `mutate` is
 * captured, and `fetch` is stubbed with deferred responses the test settles by
 * hand — the only way to control which PATCH resolves first.
 */

const BASE: UserPreferences = {
  defaultView: "auto",
  timeFormat: "24h",
  showWeekNumbers: false,
  shortcutsEnabled: true,
  lastEventCalendarId: null,
};

interface PendingPatch {
  patch: Partial<UserPreferences>;
  succeed(preferences: UserPreferences): void;
  fail(message?: string): void;
}

function installFetch(): PendingPatch[] {
  const pending: PendingPatch[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      const patch = JSON.parse(String(init?.body ?? "{}")) as Partial<UserPreferences>;
      return new Promise<Response>((resolve) => {
        pending.push({
          patch,
          succeed: (preferences) =>
            resolve({ ok: true, json: async () => ({ preferences }) } as Response),
          fail: (message = "Save failed.") =>
            resolve({
              ok: false,
              json: async () => ({ error: { message } }),
            } as Response),
        });
      });
    }),
  );
  return pending;
}

function mountPreferences(pending: PendingPatch[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<UserPreferences>(preferencesKey, BASE);

  // A container, not a bare `let`: TypeScript's flow analysis does not see an
  // assignment made inside the rendered component and would narrow a `let` to
  // its initial `null`, making `mutateAsync` uncallable at the call site.
  const captured: { mutateAsync: ReturnType<typeof useUpdatePreferences>["mutateAsync"] | null } =
    { mutateAsync: null };
  function Harness() {
    captured.mutateAsync = useUpdatePreferences().mutateAsync;
    return null;
  }
  renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
  );
  const harnessMutate = captured.mutateAsync;
  if (!harnessMutate) {
    throw new Error("the preferences harness did not render");
  }
  // A `const` declared after the guard, so its type carries no `null` into the
  // hoisted `start` below.
  const mutateAsync: ReturnType<typeof useUpdatePreferences>["mutateAsync"] = harnessMutate;

  async function start(patch: Partial<UserPreferences>) {
    const before = pending.length;
    // `mutateAsync` (the mutation's own promise) settles after the hook-level
    // `onSuccess`/`onError`, so awaiting it means the cache already holds the
    // settled state. `mutate` cannot be used here: its per-call callbacks only
    // run when the observer has a React subscriber, and SSR has no effects.
    const settled = mutateAsync(patch).catch(() => undefined);
    // `fetch` is only reached once `onMutate` finished its optimistic write.
    for (let turn = 0; turn < 200 && pending.length === before; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (pending.length === before) {
      throw new Error("the PATCH never reached fetch");
    }
    return { settled, request: pending[pending.length - 1]! };
  }

  return {
    start,
    read: () => queryClient.getQueryData<UserPreferences>(preferencesKey),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUpdatePreferences cache ordering", () => {
  it("keeps a newer successful PATCH when an older PATCH fails afterwards", async () => {
    const pending = installFetch();
    const { start, read } = mountPreferences(pending);

    // A starts: optimistic `showWeekNumbers: true` (snapshot S0 = BASE).
    const older = await start({ showWeekNumbers: true });
    expect(read()).toEqual({ ...BASE, showWeekNumbers: true });
    expect(older.request.patch).toEqual({ showWeekNumbers: true });

    // B starts and succeeds first, writing the canonical row.
    const newer = await start({ timeFormat: "12h" });
    expect(newer.request.patch).toEqual({ timeFormat: "12h" });
    newer.request.succeed({ ...BASE, timeFormat: "12h" });
    await newer.settled;
    expect(read()).toEqual({ ...BASE, timeFormat: "12h" });

    // Only now does A reject. Its S0 rollback must not discard B's canonical row.
    older.request.fail("Save failed.");
    await older.settled;

    expect(read()).toEqual({ ...BASE, timeFormat: "12h" });
  });

  it("still rolls back a single failing PATCH when it is the latest one", async () => {
    const pending = installFetch();
    const { start, read } = mountPreferences(pending);

    const only = await start({ timeFormat: "12h" });
    expect(read()).toEqual({ ...BASE, timeFormat: "12h" });

    only.request.fail("Save failed.");
    await only.settled;

    expect(read()).toEqual(BASE);
  });

  it("reverts an older failed PATCH's untouched keys once the newer PATCH also fails", async () => {
    const pending = installFetch();
    const { start, read } = mountPreferences(pending);

    const older = await start({ showWeekNumbers: true });
    const newer = await start({ timeFormat: "12h" });

    // The latest failure restores its own snapshot, which still carries the
    // older optimistic value; the older failure must then drop just its key.
    newer.request.fail("Save failed.");
    await newer.settled;
    expect(read()).toEqual({ ...BASE, showWeekNumbers: true });

    older.request.fail("Save failed.");
    await older.settled;
    expect(read()).toEqual(BASE);
  });
});
