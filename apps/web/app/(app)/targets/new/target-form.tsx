"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client/api";

type LocatorKind = "auto" | "label" | "placeholder" | "testId" | "css" | "button" | "text";

function toLocator(kind: LocatorKind, value: string) {
  const v = value.trim();
  if (kind === "auto" || !v) return undefined;
  if (kind === "button") return { by: "role", role: "button", name: v };
  return { by: kind, value: v };
}

function lines(v: FormDataEntryValue | null): string[] {
  return String(v ?? "")
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function LocatorField({ name, label, hint }: { name: string; label: string; hint: string }) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="row">
        <label className="inline">
          Strategy
          <select name={`${name}Kind`} defaultValue="auto">
            <option value="auto">Automatic detection</option>
            <option value="label">Form label</option>
            <option value="placeholder">Placeholder</option>
            <option value="testId">Test ID</option>
            <option value="button">Button accessible name</option>
            <option value="text">Visible text</option>
            <option value="css">CSS selector (fallback)</option>
          </select>
        </label>
        <label className="inline" style={{ flex: 1 }}>
          Value
          <input name={`${name}Value`} />
        </label>
      </div>
      <p className="hint">{hint}</p>
    </fieldset>
  );
}

export function TargetForm({ demoDefaults }: { demoDefaults: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<"none" | "form">("form");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const opt = (k: string) => get(k) || undefined;
    const body: Record<string, unknown> = {
      projectName: get("projectName"),
      name: get("name"),
      baseUrl: get("baseUrl"),
      brief: get("brief"),
      authorizationConfirmed: fd.get("authorizationConfirmed") === "on",
      isStaging: fd.get("isStaging") === "on",
      allowedOrigins: lines(fd.get("allowedOrigins")),
      allowPrivateNetwork: fd.get("allowPrivateNetwork") === "on",
      allowDisposableWrites: fd.get("allowDisposableWrites") === "on",
      prohibitedActionsSummary: get("prohibitedActionsSummary"),
      forbiddenSelectors: lines(fd.get("forbiddenSelectors")),
      forbiddenRoutes: lines(fd.get("forbiddenRoutes")),
      buildLabel: opt("buildLabel"),
      seedResetNotes: opt("seedResetNotes"),
      roleNotes: opt("roleNotes"),
      startPath: get("startPath") || "/",
      authMode,
    };
    if (authMode === "form") {
      Object.assign(body, {
        loginUrl: opt("loginUrl"),
        loginSuccessUrlContains: opt("loginSuccessUrlContains"),
        loginSuccessLocator: toLocator("text", get("loginSuccessText")),
        usernameLocator: toLocator(
          get("usernameLocatorKind") as LocatorKind,
          get("usernameLocatorValue"),
        ),
        passwordLocator: toLocator(
          get("passwordLocatorKind") as LocatorKind,
          get("passwordLocatorValue"),
        ),
        submitLocator: toLocator(
          get("submitLocatorKind") as LocatorKind,
          get("submitLocatorValue"),
        ),
        credentialUsername: opt("credentialUsername"),
        credentialPassword: opt("credentialPassword"),
      });
    }
    try {
      const { id } = await apiFetch<{ id: string }>("/api/targets", { body });
      window.location.assign(`/targets/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <div className="grid">
        <label>
          Project name
          <input name="projectName" required defaultValue={demoDefaults ? "Demo" : ""} />
        </label>
        <label>
          Target name
          <input
            name="name"
            required
            defaultValue={demoDefaults ? "Demo task app (staging)" : ""}
          />
        </label>
        <label>
          Base staging URL
          <input
            name="baseUrl"
            type="url"
            required
            placeholder="https://staging.example.com/"
            defaultValue={demoDefaults ? "http://demo-target:4000/" : ""}
          />
        </label>
        <label>
          Build / version label <span className="hint">(optional)</span>
          <input name="buildLabel" defaultValue={demoDefaults ? "demo-1.0" : ""} />
        </label>
      </div>

      <label>
        Application brief (Markdown or plain text)
        <span className="hint">
          Describe purpose, roles, key journeys and business rules. Treated as untrusted input;
          never executed.
        </span>
        <textarea name="brief" required rows={10} />
      </label>

      <fieldset>
        <legend>Authorisation and environment</legend>
        <label className="inline">
          <input type="checkbox" name="authorizationConfirmed" /> I am authorised to test this
          target.
        </label>
        <label className="inline">
          <input type="checkbox" name="isStaging" /> This is a staging/test environment using
          synthetic data only.
        </label>
      </fieldset>

      <fieldset>
        <legend>Safety policy</legend>
        <label>
          Allowlisted origins{" "}
          <span className="hint">
            (one per line, e.g. https://staging.example.com — the base URL origin must be included)
          </span>
          <textarea
            name="allowedOrigins"
            rows={3}
            required
            defaultValue={demoDefaults ? "http://demo-target:4000" : ""}
          />
        </label>
        <label className="inline">
          <input type="checkbox" name="allowPrivateNetwork" /> Target is on localhost / a private
          network (explicit opt-in)
        </label>
        <label className="inline">
          <input type="checkbox" name="allowDisposableWrites" defaultChecked={demoDefaults} /> Allow
          creating and editing disposable, run-prefixed records
        </label>
        <label>
          Prohibited actions summary
          <textarea
            name="prohibitedActionsSummary"
            rows={3}
            defaultValue="No purchases or payments. Do not delete pre-existing data. Do not send emails, messages or notifications. Do not trigger external integrations."
          />
        </label>
        <div className="grid">
          <label>
            Forbidden CSS selectors <span className="hint">(one per line)</span>
            <textarea name="forbiddenSelectors" rows={2} />
          </label>
          <label>
            Forbidden routes{" "}
            <span className="hint">(path prefixes, one per line, e.g. /admin/billing)</span>
            <textarea name="forbiddenRoutes" rows={2} />
          </label>
        </div>
        <label>
          Seed/reset instructions{" "}
          <span className="hint">(documentation only — TestApp never executes these)</span>
          <textarea name="seedResetNotes" rows={2} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Authentication</legend>
        <div className="row" role="radiogroup" aria-label="Authentication mode">
          <label className="inline">
            <input
              type="radio"
              name="authMode"
              checked={authMode === "none"}
              onChange={() => setAuthMode("none")}
            />{" "}
            None
          </label>
          <label className="inline">
            <input
              type="radio"
              name="authMode"
              checked={authMode === "form"}
              onChange={() => setAuthMode("form")}
            />{" "}
            Form login
          </label>
        </div>
        {authMode === "form" && (
          <div className="stack">
            <div className="grid">
              <label>
                Login URL
                <input
                  name="loginUrl"
                  type="url"
                  defaultValue={demoDefaults ? "http://demo-target:4000/login" : ""}
                />
              </label>
              <label>
                Post-login starting path
                <input name="startPath" defaultValue={demoDefaults ? "/tasks" : "/"} />
              </label>
              <label>
                Success: URL contains
                <input name="loginSuccessUrlContains" defaultValue={demoDefaults ? "/tasks" : ""} />
              </label>
              <label>
                Success: visible text <span className="hint">(optional)</span>
                <input name="loginSuccessText" />
              </label>
            </div>
            <div className="grid">
              <label>
                Synthetic username
                <input name="credentialUsername" autoComplete="off" />
              </label>
              <label>
                Synthetic password
                <input name="credentialPassword" type="password" autoComplete="new-password" />
                <span className="hint">
                  Encrypted at rest; never shown again or sent to the LLM.
                </span>
              </label>
            </div>
            <details>
              <summary>Explicit login locators (optional)</summary>
              <LocatorField
                name="usernameLocator"
                label="Username field"
                hint="Leave on automatic to detect by label/type."
              />
              <LocatorField
                name="passwordLocator"
                label="Password field"
                hint="Automatic uses input[type=password]."
              />
              <LocatorField
                name="submitLocator"
                label="Submit control"
                hint="Automatic looks for a sign-in/log-in button."
              />
            </details>
            <label>
              Roles and permissions notes <span className="hint">(optional)</span>
              <textarea name="roleNotes" rows={2} />
            </label>
          </div>
        )}
        {authMode === "none" && (
          <label>
            Starting path
            <input name="startPath" defaultValue="/" />
          </label>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Create target"}
        </button>
      </div>
    </form>
  );
}
