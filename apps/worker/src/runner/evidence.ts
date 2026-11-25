import { insertArtifact } from "@testapp/db";
import type { WorkerContext } from "../context";

export type ArtifactKind =
  | "screenshot"
  | "trace"
  | "axe"
  | "console_log"
  | "network_log"
  | "discovery"
  | "report_html"
  | "report_md"
  | "report_json"
  | "fix_packet";

const EXT: Record<ArtifactKind, [string, string]> = {
  screenshot: ["png", "image/png"],
  trace: ["zip", "application/zip"],
  axe: ["json", "application/json"],
  console_log: ["json", "application/json"],
  network_log: ["json", "application/json"],
  discovery: ["json", "application/json"],
  report_html: ["html", "text/html; charset=utf-8"],
  report_md: ["md", "text/markdown; charset=utf-8"],
  report_json: ["json", "application/json"],
  fix_packet: ["md", "text/markdown; charset=utf-8"],
};

/** Store bytes privately and register an artifact row linked to run/scenario/step. */
export async function saveArtifact(
  ctx: WorkerContext,
  a: {
    kind: ArtifactKind;
    label: string;
    data: Buffer;
    runId?: string;
    preflightId?: string;
    scenarioResultId?: string;
    stepResultId?: string;
  },
) {
  const [ext, contentType] = EXT[a.kind];
  const stored = await ctx.store.put(
    a.runId ? `run-${a.runId}` : `preflight-${a.preflightId}`,
    ext,
    a.data,
  );
  return insertArtifact(ctx.db, {
    runId: a.runId,
    preflightId: a.preflightId,
    scenarioResultId: a.scenarioResultId,
    stepResultId: a.stepResultId,
    kind: a.kind,
    label: a.label.slice(0, 200),
    storageKey: stored.key,
    contentType,
    sizeBytes: stored.size,
    sha256: stored.sha256,
  });
}
