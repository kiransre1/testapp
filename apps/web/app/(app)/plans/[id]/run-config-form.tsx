"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client/api";

type Budgets = {
  maxElapsedMinutes: number;
  maxScenarios: number;
  maxActionsPerScenario: number;
  maxTotalActions: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCostUsd: number;
  maxRepeatedActions: number;
  maxConsecutiveBlocked: number;
};

const FIELDS: { key: keyof Budgets; label: string; step?: string }[] = [
  { key: "maxElapsedMinutes", label: "Max elapsed minutes", step: "0.5" },
  { key: "maxScenarios", label: "Max scenarios" },
  { key: "maxActionsPerScenario", label: "Max actions per scenario" },
  { key: "maxTotalActions", label: "Max total browser actions" },
  { key: "maxInputTokens", label: "Max LLM input tokens" },
  { key: "maxOutputTokens", label: "Max LLM output tokens" },
  { key: "maxEstimatedCostUsd", label: "Max estimated LLM cost (USD)", step: "0.01" },
  { key: "maxRepeatedActions", label: "Max repeated identical actions" },
  { key: "maxConsecutiveBlocked", label: "Max consecutive blocked actions" },
];

export function RunConfigForm({ planId, defaults }: { planId: string; defaults: Budgets }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const budgets = Object.fromEntries(
          FIELDS.map((f) => [f.key, Number(fd.get(f.key))]),
        ) as Budgets;
        setBusy(true);
        setError(null);
        try {
          const r = await apiFetch<{ runId: string }>(`/api/plans/${planId}/runs`, {
            body: {
              browserProfile: fd.get("browserProfile"),
              budgets,
              analyse: fd.get("analyse") === "on",
            },
          });
          window.location.assign(`/runs/${r.runId}`);
        } catch (x) {
          setError(x instanceof Error ? x.message : "failed");
          setBusy(false);
        }
      }}
    >
      <label>
        Browser profile
        <select name="browserProfile" defaultValue="chromium-desktop">
          <option value="chromium-desktop">Chromium — desktop (1366×900)</option>
          <option value="chromium-mobile">Chromium — mobile viewport (390×844)</option>
          <option value="firefox-desktop">Firefox — desktop (smoke)</option>
          <option value="webkit-desktop">WebKit — desktop (smoke)</option>
        </select>
      </label>
      <details>
        <summary>Hard budgets (defaults are conservative)</summary>
        <div className="grid">
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                name={f.key}
                type="number"
                min="0"
                step={f.step ?? "1"}
                defaultValue={defaults[f.key]}
                required
              />
            </label>
          ))}
        </div>
        <p className="hint">
          Cost is only estimated when model pricing is configured; token and time caps are enforced
          independently.
        </p>
      </details>
      <label className="inline">
        <input type="checkbox" name="analyse" defaultChecked /> Generate UX and agentic
        recommendations after execution
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div>
        <button type="submit" disabled={busy}>
          {busy ? "Starting…" : "Start run"}
        </button>
      </div>
    </form>
  );
}
