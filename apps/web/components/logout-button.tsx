"use client";

import { apiFetch } from "@/lib/client/api";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await apiFetch("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
        window.location.assign("/login");
      }}
    >
      Sign out
    </button>
  );
}
