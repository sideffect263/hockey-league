// ============================================================================
// stream-sweep -- make sure every app (RTMP) broadcast's recordings end up on the game.
//
// stream-replay swaps a row from its live input to the recording, but only when someone
// calls it: the streamer's app after stopping, or a viewer's page that finds an idle input.
// Two ways that left footage invisible (2026-10-24):
//   - nobody called it: game 2's 58-min recording sat on its live input (hidden camera,
//     app closed, no viewer) until it was swapped by hand;
//   - the phone reconnected to the SAME input after a viewer had already swapped the row:
//     the new recording had no row, and stream-replay skips swapped rows.
// This runs from pg_cron every 5 min (supabase/stream-sweep.sql). For every RTMP input
// used in the last 36 h it lists the input's recordings on Cloudflare and attaches each
// finished one that no row points at yet: into the row still on the input if there is one,
// else as a new part of the same camera. Inputs still on air or still encoding are left
// alone; the next run picks them up. A partial unique index on video_id makes a race with
// stream-replay insert nothing twice. A recording deleted in the control room left a
// tombstone (game-video-tombstones.sql) and is never attached again.
//
// Auth: bearer must equal our own service-role key (verify_jwt alone admits the public
// anon key). Secrets: CF_ACCOUNT_ID / CF_STREAM_TOKEN.
// POST {} -> { ok, inputs, attached: [{ input, video, row }], skipped: { live, processing } }
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN")!;
const CF_API = "https://api.cloudflare.com/client/v4";
const WINDOW_HOURS = 36;

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Row = {
  id: string; game_id: string; provider: string; video_id: string; cf_live_input: string;
  cf_customer_code: string | null; created_by: string | null; camera_no: number | null;
  camera_label: string | null; created_at: string;
};

Deno.serve(async (req) => {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== SB_SERVICE_ROLE) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const { data: rows, error } = await admin
    .from("game_videos")
    .select("id, game_id, provider, video_id, cf_live_input, cf_customer_code, created_by, camera_no, camera_label, created_at")
    .eq("ingest", "rtmp")
    .not("cf_live_input", "is", null)
    .gte("created_at", since)
    .order("created_at");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const byInput = new Map<string, Row[]>();
  for (const r of (rows ?? []) as Row[]) {
    const list = byInput.get(r.cf_live_input) ?? [];
    list.push(r);
    byInput.set(r.cf_live_input, list);
  }

  // Recordings someone deleted in the control room (game-video-tombstones.sql): never
  // attach them again.
  const { data: tombs } = await admin.from("game_video_tombstones").select("video_id")
    .in("game_id", [...new Set(((rows ?? []) as Row[]).map((r) => r.game_id))]);
  const deleted = new Set((tombs ?? []).map((t: { video_id: string }) => t.video_id));

  const attached: { input: string; video: string; row: string }[] = [];
  const skipped = { live: 0, processing: 0 };
  const errors: string[] = [];

  for (const [input, list] of byInput) {
    const r = await fetch(`${CF_API}/accounts/${CF_ACCOUNT_ID}/stream/live_inputs/${input}/videos`, {
      headers: { authorization: `Bearer ${CF_TOKEN}` },
    });
    const cf = await r.json().catch(() => null);
    if (!cf?.success) { errors.push(`${input}: cloudflare ${r.status}`); continue; }
    const videos: any[] = cf.result ?? [];
    if (videos.some((v) => v?.status?.state === "live-inprogress")) { skipped.live++; continue; }
    const recs = videos.filter((v) => v?.uid && v?.status?.state !== "error");
    if (recs.some((v) => !v.readyToStream)) { skipped.processing++; continue; }

    const known = new Set(list.map((x) => x.video_id));
    const missing = recs.filter((v) => !known.has(v.uid) && !deleted.has(v.uid))
      .sort((a, b) => String(a.created).localeCompare(String(b.created)));
    if (!missing.length) continue;

    // The row still on the input takes the first missing recording (same guarded swap as
    // stream-replay); every other one becomes a new part of the same camera.
    const onInput = list.find((x) => x.video_id === input);
    let rest = missing;
    if (onInput) {
      const first = missing[0];
      const { data: swapped, error: upErr } = await admin
        .from("game_videos")
        .update({ video_id: first.uid, kind: "full", created_at: first.created })
        .eq("id", onInput.id)
        .eq("video_id", input)
        .select("id");
      if (upErr) { errors.push(`${input}: swap ${upErr.message}`); continue; }
      if (!swapped?.length) continue; // stream-replay got there first; next run re-checks
      attached.push({ input, video: first.uid, row: onInput.id });
      rest = missing.slice(1);
    }
    const base = onInput ?? list[0];
    for (const v of rest) {
      const { data: ins, error: insErr } = await admin.from("game_videos").insert({
        game_id: base.game_id,
        provider: base.provider,
        video_id: v.uid,
        kind: "full",
        is_primary: true,
        cf_customer_code: base.cf_customer_code,
        created_by: base.created_by,
        // Same camera (angle); `hidden` follows that camera's approval (game_videos_guard_hidden).
        camera_no: base.camera_no,
        camera_label: base.camera_label,
        ingest: "rtmp",
        cf_live_input: input,
        created_at: v.created,
      }).select("id").maybeSingle();
      // 23505 = another caller attached it a moment ago (unique video_id).
      if (insErr) { if (insErr.code !== "23505") errors.push(`${input}: insert ${insErr.message}`); continue; }
      attached.push({ input, video: v.uid, row: ins!.id });
    }
  }

  if (attached.length || errors.length) console.log("stream-sweep", JSON.stringify({ attached, errors }));
  return Response.json({ ok: errors.length === 0, inputs: byInput.size, attached, skipped, errors });
});
