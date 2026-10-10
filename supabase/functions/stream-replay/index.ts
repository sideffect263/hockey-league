// ============================================================================
// stream-replay -- turn a finished app (RTMP) broadcast into its recording.
//
// An RTMP broadcast's game_videos row points at the Cloudflare LIVE INPUT, which plays
// the broadcast while it's on air and "Stream has not started" once it ends. Cloudflare
// keeps the recording as a separate video; this swaps the row over to it so the game
// page shows the replay.
//
// Anon-callable on purpose: the streamer's app calls it after stopping, and any viewer's
// page calls it when it finds a row still pointing at an idle input — so the swap
// happens even if the app died mid-game. It trusts nothing from the caller but a row id:
// the row is read server-side, only RTMP rows still on their live input are touched, and
// the recording is looked up from Cloudflare with our own token. Idempotent.
//
// POST { videoRowId } -> { state: "live" | "processing" | "ready" | "none" | "skip", videoId?, parts? }
// A broadcast that dropped for longer than the input's timeout leaves several recordings;
// each becomes its own game_videos row, ordered by created_at (the game page's חלק 1, 2…).
//
// Secrets: CF_ACCOUNT_ID / CF_STREAM_TOKEN. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are auto-injected.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN")!;
const CF_API = "https://api.cloudflare.com/client/v4";

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let rowId = "";
  try {
    const b = await req.json();
    rowId = String(b?.videoRowId ?? "");
  } catch { /* 400 below */ }
  if (!UUID.test(rowId)) return json({ error: "missing videoRowId" }, 400);

  const { data: row, error } = await admin
    .from("game_videos")
    .select("id, video_id, ingest, cf_live_input")
    .eq("id", rowId)
    .maybeSingle();
  if (error) return json({ error: "lookup failed" }, 500);
  if (!row) return json({ state: "none" });
  // Only RTMP rows still sitting on their live input need (or may get) a swap.
  if (row.ingest !== "rtmp" || !row.cf_live_input || row.video_id !== row.cf_live_input) {
    return json({ state: "skip", videoId: row.video_id });
  }

  const r = await fetch(
    `${CF_API}/accounts/${CF_ACCOUNT_ID}/stream/live_inputs/${row.cf_live_input}/videos`,
    { headers: { authorization: `Bearer ${CF_TOKEN}` } },
  );
  const cf = await r.json().catch(() => null);
  if (!cf?.success) {
    console.log("cloudflare list videos failed", r.status, JSON.stringify(cf));
    return json({ error: "cloudflare error" }, 502);
  }
  const videos: any[] = cf.result ?? [];
  if (videos.some((v) => v?.status?.state === "live-inprogress")) return json({ state: "live" });

  // One recording per broadcast. A reconnect inside the input's timeout continues the
  // same recording; a longer outage starts a new one. Every piece becomes a PART of the
  // game (חלק 1, חלק 2…): the first takes over this row, the rest get rows of their own.
  // Wait until every piece is encoded so the parts appear together and in order.
  const recs = videos.filter((v) => v?.uid && v?.status?.state !== "error");
  if (!recs.length) return json({ state: "none" });
  if (recs.some((v) => !v.readyToStream)) return json({ state: "processing" });
  recs.sort((a, b) => String(a.created).localeCompare(String(b.created)));
  const [first, ...rest] = recs;

  const { data: swapped, error: upErr } = await admin
    .from("game_videos")
    .update({ video_id: first.uid, kind: "full", created_at: first.created })
    .eq("id", row.id)
    .eq("video_id", row.cf_live_input) // no-op if another caller already swapped it
    .select("id");
  if (upErr) {
    console.log("game_videos swap failed", upErr.message);
    return json({ error: "update failed" }, 500);
  }
  // Only the caller that won the swap adds the extra parts — no duplicates on a race.
  if (swapped?.length && rest.length) {
    const { data: base } = await admin
      .from("game_videos")
      .select("game_id, provider, cf_customer_code, created_by, camera_no, camera_label")
      .eq("id", row.id)
      .single();
    const { error: insErr } = await admin.from("game_videos").insert(rest.map((v) => ({
      game_id: base!.game_id,
      provider: base!.provider,
      video_id: v.uid,
      kind: "full",
      is_primary: true,
      cf_customer_code: base!.cf_customer_code,
      created_by: base!.created_by,
      // Extra parts belong to the same camera (angle) as the row they split from.
      camera_no: base!.camera_no,
      camera_label: base!.camera_label,
      ingest: "rtmp",
      cf_live_input: row.cf_live_input,
      created_at: v.created,
    })));
    if (insErr) console.log("extra parts insert failed", insErr.message);
  }
  return json({ state: "ready", videoId: first.uid, parts: recs.length });
});
