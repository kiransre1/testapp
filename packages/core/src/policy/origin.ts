/**
 * Origin and navigation policy. Deterministic, applied by the worker to every
 * top-level navigation and redirect and by the web app at target intake. It is
 * defence in depth, not a hostile-target sandbox: DNS is not pinned, so a
 * public hostname that later resolves to a private address (DNS rebinding) is
 * not detected here. See docs/SECURITY_AND_SAFETY.md.
 */

export type OriginPolicy = {
  allowedOrigins: readonly string[];
  allowPrivateNetwork: boolean;
  demoMode: boolean;
  demoHostnames: readonly string[];
};

export type HostClass =
  | "metadata"
  | "link_local"
  | "loopback"
  | "private"
  | "internal_name"
  | "public";

export type UrlDecision =
  | { allowed: true; url: URL; hostClass: HostClass }
  | { allowed: false; reason: string; code: UrlBlockCode };

export type UrlBlockCode =
  | "invalid_url"
  | "scheme"
  | "embedded_credentials"
  | "metadata"
  | "link_local"
  | "origin_not_allowlisted"
  | "private_network"
  | "forbidden_route";

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata",
  "metadata.azure.internal",
  "instance-data",
  "instance-data.ec2.internal",
  "100.100.100.200",
  "169.254.169.254",
  "169.254.170.2",
  "[fd00:ec2::254]",
]);

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

function classifyIPv4([a, b]: number[]): HostClass {
  if (a === undefined || b === undefined) return "public";
  if (a === 169 && b === 254) return "link_local";
  if (a === 127 || a === 0) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";
  return "public";
}

export function classifyHost(hostnameRaw: string): HostClass {
  const host = hostnameRaw.toLowerCase();
  if (METADATA_HOSTS.has(host)) return "metadata";
  const v4 = parseIPv4(host);
  if (v4) return classifyIPv4(v4);
  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = host.slice(1, -1);
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped?.[1]) {
      const p = parseIPv4(mapped[1]);
      if (p) return classifyIPv4(p);
    }
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (mappedHex?.[1] && mappedHex[2]) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      return classifyIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }
    if (v6 === "::1" || v6 === "::") return "loopback";
    if (/^fe[89ab]/.test(v6)) return "link_local";
    if (/^f[cd]/.test(v6)) return "private";
    return "public";
  }
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (!host.includes(".") || /\.(local|internal|lan|home|corp|intranet)$/.test(host))
    return "internal_name";
  return "public";
}

/** WHATWG URL keeps brackets on IPv6 hostnames; normalise either form. */
function bracketHost(hostname: string): string {
  if (hostname.startsWith("[")) return hostname;
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function normaliseOrigin(o: string): string {
  try {
    return new URL(o).origin;
  } catch {
    return o.replace(/\/$/, "");
  }
}

/** Check a top-level navigation / redirect destination. */
export function checkNavigation(raw: string, policy: OriginPolicy, base?: string): UrlDecision {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return { allowed: false, code: "invalid_url", reason: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, code: "scheme", reason: `scheme ${url.protocol} is not permitted` };
  }
  if (url.username || url.password) {
    return {
      allowed: false,
      code: "embedded_credentials",
      reason: "URLs with embedded credentials are not permitted",
    };
  }
  const hostClass = classifyHost(bracketHost(url.hostname));
  if (hostClass === "metadata") {
    return {
      allowed: false,
      code: "metadata",
      reason: "cloud metadata endpoints are always blocked",
    };
  }
  if (hostClass === "link_local") {
    return {
      allowed: false,
      code: "link_local",
      reason: "link-local destinations are always blocked",
    };
  }
  const allowed = new Set(policy.allowedOrigins.map(normaliseOrigin));
  if (!allowed.has(url.origin)) {
    return {
      allowed: false,
      code: "origin_not_allowlisted",
      reason: `origin ${url.origin} is not allowlisted`,
    };
  }
  if (hostClass !== "public") {
    const isDemoHost =
      policy.demoMode &&
      policy.demoHostnames.map((h) => h.toLowerCase()).includes(url.hostname.toLowerCase());
    if (!isDemoHost && !policy.allowPrivateNetwork) {
      return {
        allowed: false,
        code: "private_network",
        reason: `${url.hostname} is a ${hostClass.replace("_", " ")} destination; enable private-network targets explicitly`,
      };
    }
  }
  return { allowed: true, url, hostClass };
}

/**
 * Check a subresource request (scripts, XHR, images). Cross-origin
 * subresources are permitted (CDNs), but non-http(s) schemes other than
 * data/blob, metadata and link-local hosts are always blocked.
 */
export function checkSubresource(raw: string): { allowed: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: "invalid URL" };
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return { allowed: true };
  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:" &&
    url.protocol !== "ws:" &&
    url.protocol !== "wss:"
  ) {
    return { allowed: false, reason: `scheme ${url.protocol} blocked` };
  }
  const cls = classifyHost(bracketHost(url.hostname));
  if (cls === "metadata" || cls === "link_local")
    return { allowed: false, reason: `${cls} destination blocked` };
  return { allowed: true };
}

/** Validate allowlisted origins at intake: private/internal origins need explicit opt-in. */
export function validateAllowedOrigins(policy: OriginPolicy): string[] {
  const errors: string[] = [];
  for (const o of policy.allowedOrigins) {
    const d = checkNavigation(o, policy);
    if (!d.allowed) errors.push(`${o}: ${d.reason}`);
  }
  return errors;
}

/** Simple forbidden-route matcher: prefix match on pathname, or glob with trailing *. */
export function isForbiddenRoute(url: URL, forbiddenRoutes: readonly string[]): boolean {
  return forbiddenRoutes.some((r) => {
    const pattern = r.trim();
    if (!pattern) return false;
    if (pattern.endsWith("*")) return url.pathname.startsWith(pattern.slice(0, -1));
    return (
      url.pathname === pattern ||
      url.pathname.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`)
    );
  });
}
