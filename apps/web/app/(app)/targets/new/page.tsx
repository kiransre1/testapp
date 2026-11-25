import { getEnv } from "@/lib/server/context";
import { TargetForm } from "./target-form";

export const metadata = { title: "New target · TestApp" };

export default function NewTargetPage() {
  const demo = getEnv().DEMO_MODE;
  return (
    <>
      <h1>New target</h1>
      <p className="notice">
        Only test staging environments you are authorised to test, using synthetic accounts and
        data. External integrations (payments, email, messaging) must be disabled or mocked by the
        target owner.
      </p>
      <div className="card">
        <TargetForm demoDefaults={demo} />
      </div>
    </>
  );
}
