"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client/api";

function StatusMsg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? (
    <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "error"}>
      {msg.text}
    </p>
  ) : null;
}

function useSubmit() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      window.location.reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "failed" });
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, status: <StatusMsg msg={msg} /> };
}

export function BriefForm({ targetId, current }: { targetId: string; current: string }) {
  const { busy, run, status } = useSubmit();
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const content = String(new FormData(e.currentTarget).get("content") ?? "");
        void run(
          () => apiFetch(`/api/targets/${targetId}/brief`, { body: { content } }),
          "New brief version saved",
        );
      }}
    >
      <label>
        Brief (saving creates a new version)
        <textarea name="content" rows={12} defaultValue={current} />
      </label>
      {status}
      <div>
        <button type="submit" disabled={busy}>
          Save new brief version
        </button>
      </div>
    </form>
  );
}

export function CredentialForm({
  targetId,
  hasCredential,
}: {
  targetId: string;
  hasCredential: boolean;
}) {
  const { busy, run, status } = useSubmit();
  return (
    <form
      className="stack"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void run(
          () =>
            apiFetch(`/api/targets/${targetId}/credential`, {
              method: "PUT",
              body: { username: fd.get("username"), password: fd.get("password") },
            }),
          "Credential stored",
        );
      }}
    >
      <p className="muted small">
        {hasCredential
          ? "A synthetic credential is stored (encrypted). It is never displayed. Submit to replace it."
          : "No credential stored."}
      </p>
      <div className="grid">
        <label>
          Synthetic username
          <input name="username" required autoComplete="off" />
        </label>
        <label>
          Synthetic password
          <input name="password" type="password" required autoComplete="new-password" />
        </label>
      </div>
      {status}
      <div>
        <button type="submit" disabled={busy}>
          {hasCredential ? "Replace credential" : "Store credential"}
        </button>
      </div>
    </form>
  );
}

type Settings = {
  baseUrl: string;
  allowedOrigins: string[];
  allowDisposableWrites: boolean;
  allowPrivateNetwork: boolean;
  buildLabel: string | null;
  startPath: string;
  forbiddenRoutes: string[];
  forbiddenSelectors: string[];
  prohibitedActionsSummary: string;
};

export function SettingsForm({ targetId, s }: { targetId: string; s: Settings }) {
  const { busy, run, status } = useSubmit();
  const split = (v: FormDataEntryValue | null) =>
    String(v ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const body = {
          baseUrl: String(fd.get("baseUrl")),
          allowedOrigins: split(fd.get("allowedOrigins")),
          allowDisposableWrites: fd.get("allowDisposableWrites") === "on",
          allowPrivateNetwork: fd.get("allowPrivateNetwork") === "on",
          buildLabel: String(fd.get("buildLabel") ?? ""),
          startPath: String(fd.get("startPath") || "/"),
          forbiddenRoutes: split(fd.get("forbiddenRoutes")),
          forbiddenSelectors: split(fd.get("forbiddenSelectors")),
          prohibitedActionsSummary: String(fd.get("prohibitedActionsSummary") ?? ""),
        };
        void run(
          () => apiFetch(`/api/targets/${targetId}`, { method: "PATCH", body }),
          "Settings saved",
        );
      }}
    >
      <div className="grid">
        <label>
          Base URL
          <input name="baseUrl" defaultValue={s.baseUrl} />
        </label>
        <label>
          Build label
          <input name="buildLabel" defaultValue={s.buildLabel ?? ""} />
        </label>
        <label>
          Starting path
          <input name="startPath" defaultValue={s.startPath} />
        </label>
      </div>
      <label>
        Allowlisted origins (one per line)
        <textarea name="allowedOrigins" rows={2} defaultValue={s.allowedOrigins.join("\n")} />
      </label>
      <label className="inline">
        <input
          type="checkbox"
          name="allowDisposableWrites"
          defaultChecked={s.allowDisposableWrites}
        />{" "}
        Allow disposable create/edit actions
      </label>
      <label className="inline">
        <input type="checkbox" name="allowPrivateNetwork" defaultChecked={s.allowPrivateNetwork} />{" "}
        Private-network target
      </label>
      <div className="grid">
        <label>
          Forbidden routes
          <textarea name="forbiddenRoutes" rows={2} defaultValue={s.forbiddenRoutes.join("\n")} />
        </label>
        <label>
          Forbidden selectors
          <textarea
            name="forbiddenSelectors"
            rows={2}
            defaultValue={s.forbiddenSelectors.join("\n")}
          />
        </label>
      </div>
      <label>
        Prohibited actions summary
        <textarea
          name="prohibitedActionsSummary"
          rows={2}
          defaultValue={s.prohibitedActionsSummary}
        />
      </label>
      {status}
      <div>
        <button type="submit" disabled={busy}>
          Save settings
        </button>
      </div>
    </form>
  );
}
