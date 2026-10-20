import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor } from "better-auth/plugins";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";
import { MAX_USERS, countUsers } from "./users";

export interface CreateAuthOptions {
  /** Provisioning scripts and tests open sign-up; the running app never does. */
  allowSignUp?: boolean;
  /** Tests disable the limiter; it is module-global and would leak between cases. */
  rateLimit?: boolean;
}

function resolveSecret(): string {
  if (env.BETTER_AUTH_SECRET) {
    return env.BETTER_AUTH_SECRET;
  }
  if (env.NODE_ENV === "test") {
    return "test-only-secret-0123456789abcdef0123456789";
  }
  throw new Error(
    "BETTER_AUTH_SECRET is required. Generate one with: openssl rand -base64 32",
  );
}

/**
 * Builds a Better Auth instance bound to a specific database. Exported as a
 * factory so tests can bind it to an in-memory database.
 */
export function createAuth(database: Database, options: CreateAuthOptions = {}) {
  return betterAuth({
    appName: "Nailong Planner",
    baseURL: env.BETTER_AUTH_URL,
    secret: resolveSecret(),
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.allowSignUp !== true,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Single-instance deployment (SQLite), so the in-memory limiter is correct.
    rateLimit: {
      enabled: options.rateLimit !== false,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.BETTER_AUTH_URL.startsWith("https://"),
      },
    },
    trustedOrigins: [env.BETTER_AUTH_URL],
    plugins: [admin(), twoFactor()],
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => {
            if (countUsers(database) >= MAX_USERS) {
              throw new APIError("FORBIDDEN", {
                message: "This planner is limited to two accounts.",
              });
            }
            return { data: newUser };
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** The app's auth instance, lazily bound to the application database. */
export function getAuth(): ReturnType<typeof createAuth> {
  if (!instance) {
    instance = createAuth(getDb(), { rateLimit: env.AUTH_RATE_LIMIT !== "off" });
  }
  return instance;
}
