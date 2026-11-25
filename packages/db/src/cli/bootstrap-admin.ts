import { createDb } from "../client";
import { bootstrapAdmin } from "../services/auth";

/**
 * Non-interactive single-user bootstrap. Reads BOOTSTRAP_ADMIN_EMAIL and
 * BOOTSTRAP_ADMIN_PASSWORD. Idempotent: does nothing if a user exists.
 * With --if-configured, exits 0 when the variables are not set.
 */
const ifConfigured = process.argv.includes("--if-configured");
const url = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

async function main(): Promise<number> {
  if (!url) {
    console.error("DATABASE_URL is required");
    return 2;
  }
  if (!email || !password) {
    if (ifConfigured) {
      console.log(
        JSON.stringify({ msg: "bootstrap skipped: BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set" }),
      );
      return 0;
    }
    console.error("BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required");
    return 2;
  }
  const handle = createDb(url, { max: 1 });
  try {
    const result = await bootstrapAdmin(handle.db, email, password);
    console.log(JSON.stringify({ msg: `bootstrap: ${result}` }));
    return 0;
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "bootstrap failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return 1;
  } finally {
    await handle.close();
  }
}

main().then((code) => process.exit(code));
