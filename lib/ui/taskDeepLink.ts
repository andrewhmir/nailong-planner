/**
 * The decision table for the `/tasks?task=<id>` deep link that a calendar task
 * chip pushes. It lives here, pure, because the interesting part is an ordering
 * rule that is invisible in the effect's happy path:
 *
 * **the param may only be marked handled once its lookup settles.** The effect
 * that owns it starts an async `GET /api/tasks/{id}`. React 19's development
 * StrictMode (`reactStrictMode: true` in `next.config.ts`) runs setup → cleanup
 * → setup on mount: the first setup's cleanup cancels that closure before the
 * response lands, so the second setup must still consider the param pending and
 * await the *same* in-flight request (cached in a ref keyed by the param). The
 * original bug marked the param handled synchronously, before the await: the
 * second setup returned early and the first closure saw `cancelled === true`,
 * so `setEditorTask` never ran and the editor never opened. Unit-testing the
 * table keeps that sequence from regressing without mounting the client shell.
 */
export type TaskDeepLinkAction =
  /** No `?task=` param: clear the one-shot markers. */
  | "reset"
  /** The lookup already settled (opened, toasted or failed): do nothing. */
  | "skip"
  /** The open view's rows already hold the task: open it without a request. */
  | "open-cached"
  /** This param's request is still in flight: await it instead of refetching. */
  | "await-request"
  /** Nothing cached and nothing pending: start the one GET. */
  | "fetch";

export interface TaskDeepLinkState {
  /** The `?task=` value, or `null` when absent/empty. */
  param: string | null;
  /** The param whose lookup has settled; `null` while nothing has settled. */
  handled: string | null;
  /** True when the open view's rows already contain the task. */
  hasCachedRow: boolean;
  /** The param of the request cached in the effect's ref, if any. */
  pendingParam: string | null;
}

/**
 * What the deep-link effect should do for this render. `handled` is deliberately
 * checked first: a settled param is one-shot even while a stale row is cached.
 */
export function taskDeepLinkAction({
  param,
  handled,
  hasCachedRow,
  pendingParam,
}: TaskDeepLinkState): TaskDeepLinkAction {
  if (param === null) {
    return "reset";
  }
  if (handled === param) {
    return "skip";
  }
  if (hasCachedRow) {
    return "open-cached";
  }
  if (pendingParam === param) {
    return "await-request";
  }
  return "fetch";
}
