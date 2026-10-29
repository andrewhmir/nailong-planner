/** Thrown before any fetch when the browser is known to be offline. */
export const OFFLINE_MESSAGE = "You're offline — changes can't be saved.";

/** Throw the offline message without touching the network (raw-fetch deletes). */
export function assertOnline(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error(OFFLINE_MESSAGE);
  }
}

export interface ApiErrorBody {
  error?: { message?: string };
}

/**
 * The one JSON request helper for the client query layer.
 *
 * The offline check runs before `fetch`: TanStack mutations are configured with
 * `networkMode: "always"` (app/providers.tsx) so an offline write fails
 * immediately and rolls back through the existing `onError` paths instead of
 * pausing and replaying later. Online behaviour is byte-identical to the five
 * helpers this replaced: JSON body, non-ok throws the API error envelope.
 */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  assertOnline();
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Something went wrong.");
  }
  return payload as T;
}