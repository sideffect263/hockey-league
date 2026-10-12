// ============================================================================
// shrink-crest — every newly set team crest is re-encoded to at most 256px.
//
// Called by the `teams_shrink_crest` trigger (pg_net) whenever teams.logo_url
// changes, NOT by end users. Web, iOS and Android all finish a crest upload with
// set_team_logo(), so doing it here covers every client without an app release.
//
// Why: uploads arrive as phone photos / 512px exports (160–360 KB) and are drawn
// at 14–56 px; the /games page alone pulled ~1.6 MB of crests. A 256px copy is
// sharp at 3× the largest on-screen size and is ~20–60 KB.
//
// The original upload is kept in the bucket. logo_url is swapped only if it still
// points at the file we shrank, so a newer upload that lands meanwhile wins.
// Output names start with "crest-256", which the trigger skips — no loop.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { shrinkCrest } from "./shrink.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // auto-injected
const BUCKET = "team-logos";
const PUBLIC_PREFIX = `${SB_URL}/storage/v1/object/public/${BUCKET}/`;
const MAX_BYTES = 15_000_000;

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  // The anon key is a valid JWT too, so verify_jwt alone would let anyone call
  // this. The trigger sends the service-role key from the vault.
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== SB_SERVICE_ROLE) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

  let teamId = "", url = "";
  try {
    ({ team_id: teamId, url } = await req.json());
  } catch { /* fall through */ }
  if (!teamId || !url) return Response.json({ ok: false, error: "team_id and url required" }, { status: 400 });

  // Only our own bucket, only this team's folder — never fetch an arbitrary URL.
  if (!url.startsWith(PUBLIC_PREFIX + teamId + "/")) return Response.json({ ok: true, skipped: "not our bucket" });
  const path = decodeURIComponent(url.slice(PUBLIC_PREFIX.length));
  if (path.split("/").pop()!.startsWith("crest-256")) return Response.json({ ok: true, skipped: "already shrunk" });

  try {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path);
    if (dlErr || !blob) throw new Error(`download: ${dlErr?.message ?? "empty"}`);
    if (blob.size > MAX_BYTES) return Response.json({ ok: true, skipped: "too large" });

    const out = await shrinkCrest(new Uint8Array(await blob.arrayBuffer()));
    if (!out) return Response.json({ ok: true, skipped: "already small" });

    const newPath = `${teamId}/crest-256-${Date.now()}.${out.ext}`;
    const { error: upErr } = await admin.storage.from(BUCKET)
      .upload(newPath, out.data, { contentType: out.type, cacheControl: "604800", upsert: false });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const newUrl = PUBLIC_PREFIX + newPath;
    const { data: rows, error: updErr } = await admin.from("teams")
      .update({ logo_url: newUrl }).eq("id", teamId).eq("logo_url", url).select("id");
    if (updErr) throw new Error(`update: ${updErr.message}`);

    return Response.json({ ok: true, from: blob.size, to: out.data.length, url: newUrl, swapped: (rows ?? []).length === 1 });
  } catch (e) {
    // Leave the original crest in place — it works, it is only big.
    console.error("shrink-crest", teamId, path, e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
