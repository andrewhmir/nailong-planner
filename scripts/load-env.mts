import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

/** Loads `.env.local` (preferred) or `.env` into process.env before app modules read it. */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      loadEnvFile(file);
      return;
    }
  }
}
