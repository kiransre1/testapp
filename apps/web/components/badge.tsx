export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`badge ${value}`}>{label ?? value.replaceAll("_", " ")}</span>;
}

export function FakeBadge({ isFake }: { isFake: boolean }) {
  return isFake ? (
    <span className="badge fake" title="Deterministic fake provider: no real LLM was used">
      fake provider
    </span>
  ) : null;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}
