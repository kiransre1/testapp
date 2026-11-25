import { describe, expect, it } from "vitest";
import {
  checkNavigation,
  checkSubresource,
  classifyHost,
  isForbiddenRoute,
  type OriginPolicy,
} from "../src/policy/origin";

const policy: OriginPolicy = {
  allowedOrigins: ["https://staging.example.test"],
  allowPrivateNetwork: false,
  demoMode: false,
  demoHostnames: ["demo-target"],
};

describe("origin allowlisting", () => {
  it("allows allowlisted origins, relative paths resolve against base", () => {
    expect(checkNavigation("https://staging.example.test/tasks?x=1", policy).allowed).toBe(true);
    expect(checkNavigation("/tasks", policy, "https://staging.example.test/").allowed).toBe(true);
  });

  it("blocks non-allowlisted origins including port and scheme variants", () => {
    for (const u of [
      "https://evil.example.test/",
      "http://staging.example.test/",
      "https://staging.example.test:8443/",
      "https://staging.example.test.evil.test/",
    ]) {
      const d = checkNavigation(u, policy);
      expect(d.allowed, u).toBe(false);
      if (!d.allowed) expect(d.code).toBe("origin_not_allowlisted");
    }
  });

  it("blocks dangerous schemes", () => {
    for (const u of [
      "file:///etc/passwd",
      "chrome://settings",
      "data:text/html,hi",
      "javascript:alert(1)",
      "ftp://x.test/",
    ]) {
      const d = checkNavigation(u, policy);
      expect(d.allowed, u).toBe(false);
    }
  });

  it("blocks embedded credentials", () => {
    const d = checkNavigation("https://user:pw@staging.example.test/", policy);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe("embedded_credentials");
  });

  it("always blocks metadata and link-local destinations, even when allowlisted", () => {
    const p = {
      ...policy,
      allowedOrigins: [
        "http://169.254.169.254",
        "http://metadata.google.internal",
        "http://[fe80::1]",
      ],
      allowPrivateNetwork: true,
    };
    for (const u of [
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/",
      "http://[fe80::1]/",
      "http://2852039166/",
    ]) {
      expect(checkNavigation(u, p).allowed, u).toBe(false);
    }
  });

  it("requires explicit opt-in for private and localhost targets", () => {
    const p = {
      ...policy,
      allowedOrigins: ["http://localhost:3000", "http://10.0.0.5", "http://intranet"],
    };
    for (const u of ["http://localhost:3000/", "http://10.0.0.5/", "http://intranet/"]) {
      const d = checkNavigation(u, p);
      expect(d.allowed, u).toBe(false);
      if (!d.allowed) expect(d.code).toBe("private_network");
      expect(checkNavigation(u, { ...p, allowPrivateNetwork: true }).allowed, u).toBe(true);
    }
  });

  it("permits the docker demo hostname only in demo mode", () => {
    const p = { ...policy, allowedOrigins: ["http://demo-target:4000"] };
    expect(checkNavigation("http://demo-target:4000/", p).allowed).toBe(false);
    expect(checkNavigation("http://demo-target:4000/", { ...p, demoMode: true }).allowed).toBe(
      true,
    );
  });

  it("classifies hosts", () => {
    expect(classifyHost("127.0.0.1")).toBe("loopback");
    expect(classifyHost("192.168.1.10")).toBe("private");
    expect(classifyHost("172.20.0.1")).toBe("private");
    expect(classifyHost("[::ffff:169.254.169.254]")).toBe("link_local");
    expect(classifyHost("[::ffff:a9fe:a9fe]")).toBe("link_local");
    expect(classifyHost("example.com")).toBe("public");
  });

  it("checks subresources: CDNs fine, metadata and odd schemes blocked", () => {
    expect(checkSubresource("https://cdn.example.org/lib.js").allowed).toBe(true);
    expect(checkSubresource("data:image/png;base64,AAA").allowed).toBe(true);
    expect(checkSubresource("http://169.254.169.254/").allowed).toBe(false);
    expect(checkSubresource("file:///etc/hosts").allowed).toBe(false);
  });

  it("matches forbidden routes by prefix", () => {
    const u = new URL("https://staging.example.test/admin/billing/x");
    expect(isForbiddenRoute(u, ["/admin/billing"])).toBe(true);
    expect(isForbiddenRoute(u, ["/admin/bill*"])).toBe(true);
    expect(isForbiddenRoute(new URL("https://s.test/admin/billingx"), ["/admin/billing"])).toBe(
      false,
    );
  });
});
