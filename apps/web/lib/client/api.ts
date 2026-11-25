"use client";

export type ApiError = { error: string; details?: string[] };

function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? "";
}

/** JSON fetch with CSRF header; throws an Error whose message is user-presentable. */
export async function apiFetch<T = unknown>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken(),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const e = data as ApiError;
    const msg = [e.error ?? `request failed (${res.status})`, ...(e.details ?? [])].join("\n");
    throw new Error(msg);
  }
  return data as T;
}
