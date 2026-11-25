"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client/api";

export function ScenarioToggle({
  planId,
  scenarioKey,
  enabled,
}: {
  planId: string;
  scenarioKey: string;
  enabled: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [err, setErr] = useState<string | null>(null);
  return (
    <label className="inline">
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          setErr(null);
          try {
            await apiFetch(`/api/plans/${planId}/scenarios/${scenarioKey}`, {
              method: "PATCH",
              body: { enabled: next },
            });
          } catch (x) {
            setOn(!next);
            setErr(x instanceof Error ? x.message : "failed");
          }
        }}
      />
      Enabled
      {err && (
        <span role="alert" className="error small">
          {err}
        </span>
      )}
    </label>
  );
}

/** Validated JSON editor for advanced step editing. Server re-validates with the strict schema. */
export function ScenarioJsonEditor({
  planId,
  scenarioKey,
  initial,
}: {
  planId: string;
  scenarioKey: string;
  initial: unknown;
}) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `json-${scenarioKey}`;
  return (
    <div className="stack">
      <label htmlFor={id}>Scenario JSON ({scenarioKey})</label>
      <textarea
        id={id}
        className="code"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "error"}>
          {msg.text}
        </p>
      )}
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setMsg(null);
            let definition: unknown;
            try {
              definition = JSON.parse(text);
            } catch {
              setMsg({ ok: false, text: "Not valid JSON" });
              return;
            }
            setBusy(true);
            try {
              const r = await apiFetch<{ version: number }>(
                `/api/plans/${planId}/scenarios/${scenarioKey}`,
                {
                  method: "PATCH",
                  body: { definition },
                },
              );
              setMsg({ ok: true, text: `Saved as version ${r.version}` });
              window.location.reload();
            } catch (x) {
              setMsg({ ok: false, text: x instanceof Error ? x.message : "failed" });
            } finally {
              setBusy(false);
            }
          }}
        >
          Validate and save
        </button>
      </div>
    </div>
  );
}
