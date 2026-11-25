import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return (
    <>
      <meta name="csrf-token" content={session.csrfToken} />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <Link href="/" className="brand">
          TestApp
        </Link>
        <nav aria-label="Primary">
          <ul>
            <li>
              <Link href="/">Dashboard</Link>
            </li>
            <li>
              <Link href="/targets/new">New target</Link>
            </li>
            <li>
              <Link href="/runs">Runs</Link>
            </li>
          </ul>
        </nav>
        <span className="spacer" />
        <span className="small">{session.email}</span>
        <LogoutButton />
      </header>
      <main id="main" className="container">
        {children}
      </main>
    </>
  );
}
