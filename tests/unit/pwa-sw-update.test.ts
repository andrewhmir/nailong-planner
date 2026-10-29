import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UPDATE_EVENT,
  applyUpdate,
  clearOfflinePagesCache,
  notifyIfUpdateReady,
} from "@/lib/pwa/swUpdate";

class FakeWorkerContainer {
  controller = { postMessage: vi.fn() };
  private listeners = new Map<string, () => void>();

  addEventListener(type: string, handler: () => void): void {
    this.listeners.set(type, handler);
  }

  emit(type: string): void {
    this.listeners.get(type)?.();
  }
}

const reload = vi.fn();
let container: FakeWorkerContainer;

function registration(waiting: { postMessage: (message: unknown) => void } | null) {
  return { waiting } as unknown as ServiceWorkerRegistration;
}

beforeEach(() => {
  container = new FakeWorkerContainer();
  vi.stubGlobal("navigator", { serviceWorker: container });
  vi.stubGlobal("window", { location: { reload }, dispatchEvent: vi.fn() });
  reload.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("service worker update protocol", () => {
  it("is a no-op when the browser has no service worker support", () => {
    vi.stubGlobal("navigator", {});
    expect(() => clearOfflinePagesCache()).not.toThrow();
  });

  it("clears the pages cache through the controller", () => {
    clearOfflinePagesCache();
    expect(container.controller.postMessage).toHaveBeenCalledWith({ type: "CLEAR_OFFLINE" });
  });

  it("notifies only when a waiting worker exists and the page is controlled", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { location: { reload }, dispatchEvent: dispatch });
    notifyIfUpdateReady(registration({ postMessage: vi.fn() }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: UPDATE_EVENT }));

    container.controller = null as never;
    notifyIfUpdateReady(registration({ postMessage: vi.fn() }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("posts SKIP_WAITING and reloads exactly once on controllerchange", () => {
    const postMessage = vi.fn();
    applyUpdate(registration({ postMessage }));
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    container.emit("controllerchange");
    container.emit("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads rather than leaving a dead prompt when nothing is waiting", () => {
    applyUpdate(registration(null));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});