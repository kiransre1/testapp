"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polling-based live status: refreshes server components while work is in progress. */
export function AutoRefresh({
  active,
  intervalMs = 2000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return active ? (
    <p className="small muted" role="status" aria-live="polite">
      Updating automatically…
    </p>
  ) : null;
}
