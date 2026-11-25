"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client/api";

/** Button that POSTs to an API route, then navigates or refreshes. */
export function ActionButton({
  url,
  body = {},
  method = "POST",
  label,
  busyLabel,
  redirectTo,
  className,
  confirmText,
}: {
  url: string;
  body?: unknown;
  method?: string;
  label: string;
  busyLabel?: string;
  /** Use {id} etc. to interpolate fields from the JSON response. */
  redirectTo?: string;
  className?: string;
  confirmText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="stack" style={{ display: "inline-flex" }}>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          setError(null);
          try {
            const res = await apiFetch<Record<string, unknown>>(url, { method, body });
            if (redirectTo) {
              window.location.assign(
                redirectTo.replace(/\{(\w+)\}/g, (_, k: string) => String(res[k] ?? "")),
              );
            } else {
              window.location.reload();
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : "failed");
            setBusy(false);
          }
        }}
      >
        {busy ? (busyLabel ?? "Working…") : label}
      </button>
      {error && (
        <span role="alert" className="error small">
          {error}
        </span>
      )}
    </span>
  );
}
