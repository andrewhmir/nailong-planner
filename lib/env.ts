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
