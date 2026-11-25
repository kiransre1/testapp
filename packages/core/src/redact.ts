/**
 * Redaction helpers. Applied to anything that leaves the worker: logs, step
 * results, network metadata, findings, reports and LLM prompts.
 */

export const REDACTED = "[REDACTED]";

/** Replace every occurrence of each known secret value in text. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  const sorted = [...secrets].filter((s) => s && s.length >= 3).sort((a, b) => b.length - a.length);
  for (const s of sorted) {
    out = out.split(s).join(REDACTED);
    // also catch URL-encoded forms
    const enc = encodeURIComponent(s);
    if (enc !== s) out = out.split(enc).join(REDACTED);
  }
  return out;
}

/** Deeply redact secret values inside a JSON-compatible value. */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  if (typeof value === "string") return redactSecrets(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && typeof v === "string" ? REDACTED : redactDeep(v, secrets);
    }
    return out as T;
  }
  return value;
}

const SENSITIVE_KEY =
  /^(password|passwd|secret|token|apikey|api_key|authorization|cookie|set-cookie)$/i;

/**
 * Strip query string, fragment and embedded credentials from a URL.
 * Returns origin + pathname (or the input with obvious secrets removed if it
 * is not a parseable absolute URL).
 */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "data:" || u.protocol === "blob:") return `${u.protocol}[omitted]`;
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0] ?? "";
  }
}

/** Truncate long free text (console messages etc.) to a bounded size. */
export function truncate(text: string, max = 500): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}
