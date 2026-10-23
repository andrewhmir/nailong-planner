import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import type { Database } from "@/lib/db/client";
import { member } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { ViewerContext } from "@/lib/services/permissions";

export type AppSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
>;

export interface RouteArgs {
  ctx: ViewerContext;
  session: AppSession;
  db: Database;
  request: Request;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Rejects cookie-authenticated writes from a foreign origin.
 *
 * SameSite=Lax only separates *sites*, and Railway's default
 * `<service>.up.railway.app` domains are not on the Public Suffix List, so a
 * sibling Railway tenant counts as the same site and its forms would carry the
 * session cookie. Browsers always send `Origin` (and `Sec-Fetch-Site`) on
 * non-GET requests, so checking them closes that gap without affecting
 * server-to-server callers or the tests, which send no Origin.
 */
export function assertSameOrigin(request: Request): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin === null) {
    return;
  }
  const allowed = new Set(
    [originOf(request.url), originOf(env.BETTER_AUTH_URL)].filter(
      (value): value is string => value !== null,
    ),
  );
  if (!allowed.has(origin)) {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected.", 403);
  }
}

/** Resolves the signed-in member from a request's cookies. */
export async function viewerFromRequest(
  request: Request,
): Promise<{ ctx: ViewerContext; session: AppSession }> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) {
    throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }

  const membership = getDb()
    .select()
    .from(member)
    .where(eq(member.userId, session.user.id))
    .get();

  if (!membership) {
    throw new AppError("FORBIDDEN", "Your account is not part of this household.", 403);
  }

  return {
    session,
    ctx: { userId: session.user.id, householdId: membership.householdId },
  };
}

/** Maps a thrown {@link AppError} to the API error envelope; anything else is a 500. */
export function apiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      { status: error.status },
    );
  }
  console.error("[api] unhandled error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong." } },
    { status: 500 },
  );
}

/**
 * Wraps a route handler with session resolution, origin checks, database access
 * and error mapping. Because it only needs a standard `Request`, integration
 * tests can call the wrapped handler directly instead of booting Next.
 */
export function withViewer<Extra extends object = object>(
  handler: (args: RouteArgs & Extra) => Promise<Response> | Response,
): (request: Request, extra?: Extra) => Promise<Response> {
  return async (request: Request, extra?: Extra): Promise<Response> => {
    try {
      const { ctx, session } = await viewerFromRequest(request);
      assertSameOrigin(request);
      return await handler({
        ctx,
        session,
        db: getDb(),
        request,
        ...(extra ?? ({} as Extra)),
      });
    } catch (error) {
      return apiError(error);
    }
  };
}
