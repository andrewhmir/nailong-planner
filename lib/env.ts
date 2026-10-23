import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).default("file:./data/planner.db"),
  /** Required in production; tests may omit it. */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().min(1).default("http://localhost:3000"),
  /** "off" only for E2E runs, where many sign-ins share one loopback IP. */
  AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
  TZ: z.string().min(1).default("Asia/Taipei"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
}

export const env = parsed.data;
export type Env = typeof env;

/** The subset of the environment production checks read; injectable for tests. */
export interface ProductionEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
}

/**
 * Hard production requirements, checked lazily from `getDb()` rather than at
 * import time so `next build` still needs no runtime secrets.
 *
 * Without this, a container missing `BETTER_AUTH_SECRET` boots, answers
 * `/api/health` with 200 and then 500s every sign-in — the platform reports a
 * healthy deploy while nobody can log in, and the login form shows "Incorrect
 * email or password". Failing on the first request instead makes the health
 * check go 503 and Railway refuses the deploy.
 */
export function assertProductionEnv(source: ProductionEnv = process.env): void {
  if (source.NODE_ENV !== "production") {
    return;
  }

  const problems: string[] = [];
  if (!source.DATABASE_URL) {
    problems.push(
      "DATABASE_URL must be set explicitly (e.g. file:/data/planner.db); the built-in default is not on a persistent volume.",
    );
  }
  if (!source.BETTER_AUTH_SECRET) {
    problems.push(
      "BETTER_AUTH_SECRET is required (32+ characters; generate with `openssl rand -base64 32`).",
    );
  } else if (source.BETTER_AUTH_SECRET.length < 32) {
    problems.push("BETTER_AUTH_SECRET must be at least 32 characters.");
  }
  if (problems.length > 0) {
    throw new Error(`Invalid production environment:\n- ${problems.join("\n- ")}`);
  }

  const url = source.BETTER_AUTH_URL ?? env.BETTER_AUTH_URL;
  let origin: URL;
  try {
    origin = new URL(url);
  } catch {
    throw new Error(
      `Invalid production environment:\n- BETTER_AUTH_URL must be an absolute URL (got "${url}").`,
    );
  }
  if (origin.protocol !== "https:") {
    console.warn(
      `[env] BETTER_AUTH_URL is ${url}; production session cookies will not be Secure. Set it to the public HTTPS origin.`,
    );
  }
  if (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") {
    console.warn(
      "[env] BETTER_AUTH_URL points at localhost; sign-in from the public domain will fail with 403 INVALID_ORIGIN until it is set to that domain.",
    );
  }
}
