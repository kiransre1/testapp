import { runMigrations } from "../client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const started = Date.now();
runMigrations(url)
  .then(() => {
    console.log(JSON.stringify({ msg: "migrations applied", ms: Date.now() - started }));
  })
  .catch((err: unknown) => {
    console.error(
      JSON.stringify({
        msg: "migration failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  });
