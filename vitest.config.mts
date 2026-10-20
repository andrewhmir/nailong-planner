import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    pool: "threads",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file::memory:",
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "vitest-only-secret-0123456789abcdef0123",
      TZ: "Asia/Taipei",
    },
  },
});
