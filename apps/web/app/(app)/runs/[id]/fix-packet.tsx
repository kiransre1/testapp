"use client";

import { useState } from "react";

export function FixPacket({ runId }: { runId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            const res = await fetch(`/api/runs/${runId}/export?format=fixpacket`, {
              credentials: "same-origin",
            });
            setText(res.ok ? await res.text() : `Could not load fix packet (${res.status})`);
          }}
        >
          Show fix packet
        </button>
        <a
          className="button secondary"
          href={`/api/runs/${runId}/export?format=fixpacket&download=1`}
        >
          Download fix packet (.md)
        </a>
        {text && (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setMsg("Copied to clipboard");
            }}
          >
            Copy
          </button>
        )}
        {msg && (
          <span role="status" className="small muted">
            {msg}
          </span>
        )}
      </div>
      {text && (
        <label>
          Fix packet (ready to paste into the original coding assistant)
          <textarea className="code" readOnly value={text} />
        </label>
      )}
    </div>
  );
}
