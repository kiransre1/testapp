import { redirect } from "next/navigation";
import { currentSession } from "@/lib/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · TestApp" };

export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>TestApp</h1>
        <p className="muted">Private QA workbench. Sign in with the bootstrapped account.</p>
        <LoginForm />
      </div>
    </main>
  );
}
