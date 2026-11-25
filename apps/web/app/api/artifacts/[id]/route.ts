import { artifactRoot, LocalFsStore } from "@testapp/core";
import { getArtifact } from "@testapp/db";
import { api, HttpError, requireUuid } from "@/lib/server/api";
import { getDb, getEnv } from "@/lib/server/context";

const INLINE = new Set([
  "screenshot",
  "report_html",
  "report_json",
  "report_md",
  "fix_packet",
  "axe",
  "console_log",
  "discovery",
]);

/** Authenticated, authorised artifact download. Storage keys are never exposed. */
export const GET = api<{ id: string }>(async ({ req, params }) => {
  const art = await getArtifact(getDb(), requireUuid(params.id));
  if (!art) throw new HttpError(404, "not found");
  const store = new LocalFsStore(artifactRoot(getEnv().DATA_DIR));
  let data: Buffer;
  try {
    data = await store.get(art.storageKey);
  } catch {
    throw new HttpError(410, "artifact content is no longer available");
  }
  const download = new URL(req.url).searchParams.get("download") === "1" || !INLINE.has(art.kind);
  const ext = art.storageKey.split(".").pop() ?? "bin";
  const contentType =
    art.kind === "report_html" && !download ? "text/html; charset=utf-8" : art.contentType;
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": contentType,
      "content-length": String(data.length),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // Report HTML is rendered from escaped content only; still sandbox it.
      "content-security-policy":
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${art.kind}-${art.id.slice(0, 8)}.${ext}"`,
    },
  });
});
