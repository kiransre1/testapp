"use client";

import { useState } from "react";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
    });
    if (res.ok) {
      window.location.assign("/");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Sign-in failed");
    setBusy(false);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="stack"
      aria-describedby={error ? "login-error" : undefined}
    >
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && (
        <p id="login-error" role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
