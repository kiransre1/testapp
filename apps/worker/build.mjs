import { existsSync } from "node:fs";
import { build } from "esbuild";

const external = [
  "playwright",
  "playwright-core",
  "@axe-core/playwright",
  "@node-rs/argon2",
  "postgres",
  "@anthropic-ai/sdk",
];

for (const [entry, out] of [
  ["src/main.ts", "dist/main.mjs"],
  ["../../packages/db/src/cli/migrate.ts", "dist/migrate.mjs"],
  ["../../packages/db/src/cli/bootstrap-admin.ts", "dist/bootstrap-admin.mjs"],
]) {
  if (!existsSync(entry)) continue;
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
    sourcemap: true,
    external,
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "warning",
  });
}
console.log("worker build complete");
