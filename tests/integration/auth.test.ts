import { describe, expect, it } from "vitest";
import { createAuth } from "@/lib/auth/server";
import { makeTestDb } from "../helpers/db";

const BASE_URL = "http://localhost:3000";

const USER_ONE = { email: "andrew@example.test", password: "test-password-1234", name: "Andrew" };
const USER_TWO = {
  email: "partner@example.test",
  password: "test-password-1234",
  name: "Partner",
};
const USER_THREE = { email: "third@example.test", password: "test-password-1234", name: "Third" };

async function setup(options: { allowSignUp?: boolean } = {}) {
  const testDb = await makeTestDb();
  const auth = createAuth(testDb.db, { ...options, rateLimit: false });
  return { ...testDb, auth };
}

type Auth = Awaited<ReturnType<typeof setup>>["auth"];

function post(auth: Auth, path: string, body: unknown): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify(body),
    }),
  );
}

function signUp(auth: Auth, user: typeof USER_ONE) {
  return post(auth, "/sign-up/email", user);
}

function signIn(auth: Auth, email: string, password: string) {
  return post(auth, "/sign-in/email", { email, password });
}

describe("auth", () => {
  it("refuses public sign-up when sign-up is disabled", async () => {
    const { auth, close } = await setup();
    try {
      const response = await signUp(auth, USER_ONE);
      expect(response.status).toBeGreaterThanOrEqual(400);
    } finally {
      close();
    }
  });

  it("provisions exactly two users and rejects a third", async () => {
    const { auth, close } = await setup({ allowSignUp: true });
    try {
      expect((await signUp(auth, USER_ONE)).status).toBeLessThan(400);
      expect((await signUp(auth, USER_TWO)).status).toBeLessThan(400);
      expect((await signUp(auth, USER_THREE)).status).toBeGreaterThanOrEqual(400);
    } finally {
      close();
    }
  });

  it("signs in, returns a usable session cookie, and rejects a wrong password", async () => {
    const { auth, close } = await setup({ allowSignUp: true });
    try {
      await signUp(auth, USER_ONE);

      const ok = await signIn(auth, USER_ONE.email, USER_ONE.password);
      expect(ok.status).toBe(200);
      const cookie = ok.headers.get("set-cookie")?.split(";")[0] ?? "";
      expect(cookie).toContain("session");

      const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.email).toBe(USER_ONE.email);

      const bad = await signIn(auth, USER_ONE.email, "definitely-wrong-password");
      expect(bad.status).toBeGreaterThanOrEqual(400);
    } finally {
      close();
    }
  });

  it("stores a hashed password, never the plain text", async () => {
    const { db, close, auth } = await setup({ allowSignUp: true });
    try {
      await signUp(auth, USER_ONE);
      const { account } = await import("@/lib/db/auth-schema");
      const rows = db.select().from(account).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.password).toBeTruthy();
      expect(rows[0]?.password).not.toBe(USER_ONE.password);
    } finally {
      close();
    }
  });
});
