"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type Step = "credentials" | "totp" | "backup";

// Canvas field: 38px tall, 1px #8d959f stroke, 4px radius, 16px text, and a
// flat 2px blue outline on focus (no glow).
const FIELD =
  "h-[38px] w-full rounded-md border border-field bg-surface px-3 text-base text-ink placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const LABEL = "mb-1 block text-base text-ink";

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger-ink"
    >
      {message}
    </p>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function finish() {
    router.replace("/");
    router.refresh();
  }

  async function onSubmitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
        setPending(false);
        return;
      }
      if (!response.ok) {
        setError("Incorrect email or password.");
        setPending(false);
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        twoFactorRedirect?: boolean;
      } | null;

      if (payload?.twoFactorRedirect) {
        setStep("totp");
        setPending(false);
        return;
      }

      finish();
    } catch {
      setError("Could not reach the planner. Try again.");
      setPending(false);
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const endpoint = step === "backup" ? "verify-backup-code" : "verify-totp";
      const response = await fetch(`/api/auth/two-factor/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        setError(
          step === "backup"
            ? "That backup code did not work. Each code works only once."
            : "That code did not work. Check your authenticator app.",
        );
        setPending(false);
        return;
      }

      finish();
    } catch {
      setError("Could not reach the planner. Try again.");
      setPending(false);
    }
  }

  if (step !== "credentials") {
    return (
      <form className="space-y-4" onSubmit={onSubmitCode}>
        <p className="text-sm text-ink-soft">
          {step === "backup"
            ? "Enter one of your saved backup codes."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
        <div>
          <label className={LABEL} htmlFor="code">
            {step === "backup" ? "Backup code" : "Authentication code"}
          </label>
          <input
            id="code"
            value={code}
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            onChange={(event) => setCode(event.target.value)}
            className={FIELD}
          />
        </div>

        {error ? <FormError message={error} /> : null}

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={pending || code.trim().length === 0}
        >
          {pending ? "Verifying…" : "Verify"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setStep(step === "backup" ? "totp" : "backup");
            setCode("");
            setError(null);
          }}
          className="w-full text-center text-sm text-link hover:underline"
        >
          {step === "backup" ? "Use an authenticator code instead" : "Use a backup code instead"}
        </button>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmitCredentials} noValidate>
      <div>
        <label className={LABEL} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={FIELD}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={FIELD}
        />
      </div>

      {error ? <FormError message={error} /> : null}

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
