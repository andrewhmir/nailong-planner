import { describe, expect, it } from "vitest";
import { taskDeepLinkAction, type TaskDeepLinkState } from "@/lib/ui/taskDeepLink";

function state(overrides: Partial<TaskDeepLinkState> = {}): TaskDeepLinkState {
  return {
    param: "t1",
    handled: null,
    hasCachedRow: false,
    pendingParam: null,
    ...overrides,
  };
}

describe("task deep-link decision", () => {
  it("clears the one-shot markers when the param is absent", () => {
    expect(taskDeepLinkAction(state({ param: null }))).toBe("reset");
    expect(taskDeepLinkAction(state({ param: null, handled: "t1" }))).toBe("reset");
  });

  it("opens the row already in the open view without a request", () => {
    expect(taskDeepLinkAction(state({ hasCachedRow: true }))).toBe("open-cached");
  });

  it("does not skip a param while its request is still in flight", () => {
    // React StrictMode's second setup: the first closure was cancelled before
    // the response landed, so the marker must still be unset and the pending
    // request must be awaited, not skipped.
    expect(taskDeepLinkAction(state({ pendingParam: "t1" }))).toBe("await-request");
  });

  it("is one-shot only once the lookup has settled", () => {
    expect(taskDeepLinkAction(state({ handled: "t1" }))).toBe("skip");
    // A different param after a settle is a new link.
    expect(taskDeepLinkAction(state({ param: "t2", handled: "t1" }))).toBe("fetch");
  });

  it("starts a new request for a param with no pending request", () => {
    expect(taskDeepLinkAction(state())).toBe("fetch");
    expect(taskDeepLinkAction(state({ param: "t2", pendingParam: "t1" }))).toBe("fetch");
  });

  it("runs the StrictMode sequence without ever skipping before a settle", () => {
    // setup 1: start the GET.
    expect(taskDeepLinkAction(state())).toBe("fetch");
    // cleanup 1 + setup 2: same promise still pending -> await it again.
    expect(taskDeepLinkAction(state({ pendingParam: "t1" }))).toBe("await-request");
    // The awaited response lands -> the shell sets handled and opens the editor.
    expect(taskDeepLinkAction(state({ handled: "t1" }))).toBe("skip");
    // Nothing reopens the editor after the user closes it.
    expect(taskDeepLinkAction(state({ handled: "t1", hasCachedRow: true }))).toBe("skip");
  });
});
