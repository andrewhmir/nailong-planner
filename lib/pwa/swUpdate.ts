/** Dispatched on `window` when an installed worker is waiting to take over. */
export const UPDATE_EVENT = "nailong:sw-update-ready";

let reloading = false;

/**
 * Ask the waiting worker to take over, then reload exactly once when the new
 * worker controls the page. Only ever called from an explicit user action
 * (the Update ready pill or its toast action) — never automatically.
 */
export function applyUpdate(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting;
  if (!waiting) {
    return;
  }
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      if (reloading) {
        return;
      }
      reloading = true;
      window.location.reload();
    },
    { once: true },
  );
  waiting.postMessage({ type: "SKIP_WAITING" });
}

/** Fire the update prompt event when a newly installed worker is waiting. */
export function notifyIfUpdateReady(registration: ServiceWorkerRegistration): void {
  if (registration.waiting && navigator.serviceWorker.controller) {
    window.dispatchEvent(
      new CustomEvent<ServiceWorkerRegistration>(UPDATE_EVENT, { detail: registration }),
    );
  }
}
