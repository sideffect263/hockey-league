// ============================================================================
// video-seo-sync -- what Google needs to index our videos, fetched from Cloudflare.
//
// For every Cloudflare Stream video we show (post videos + full-game recordings + studio kits + game uploads):
//   1. GET  /stream/<uid>            -> duration, size, ready
//   2. POST /stream/<uid>/downloads  -> the default MP4 (idempotent; free to store)
// and upserts public.video_seo_meta, which api/seo.js + api/sitemap.js read with the
// anon key. Why: Cloudflare's robots.txt blocks /*iframe$ for crawlers, so the player
// URL alone gives Google no video it may fetch; the MP4 (or HLS manifest) does.
//
// Called by pg_cron every 10 min (supabase/video-seo-meta.sql). Only rows not yet
// complete (no duration, or MP4 not ready) are asked about, so a quiet run is cheap.
// Never touches `chapters` (the reel worker owns that column).
//
// Auth: bearer must equal our own service-role key (verify_jwt alone admits the
// public anon key). Secrets: CF_ACCOUNT_ID / CF_STREAM_TOKEN.
// POST {} or { force: true } -> { ok, checked, updated, errors }
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN")!;
const CF_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function cf(path: string, method = "GET") {
  const r = await fetch(`${CF_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok && body?.success !== false, status: r.status, result: body?.result };
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== SB_SERVICE_ROLE) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  let force = false;
  try { force = !!(await req.json())?.force; } catch { /* {} */ }

  // Every video a page shows: post videos (not deleted) + full-game Cloudflare recordings.
  // + studio kits (feed_drafts) and game uploads (game_media): their MP4 is what the creators studio
  //   downloads and what the vertical-crop worker reads (studio_worker.py).
  const [{ data: posts }, { data: games }, { data: drafts }, { data: media }, { data: known }] = await Promise.all([
    admin.from("posts").select("video_uid, video_cf_code").not("video_uid", "is", null).is("deleted_at", null),
    admin.from("game_videos").select("video_id, cf_customer_code").eq("provider", "cloudflare").eq("hidden", false),
    admin.from("feed_drafts").select("video_uid, video_cf_code").not("video_uid", "is", null),
    admin.from("game_media").select("cf_uid, cf_code").eq("kind", "video").not("cf_uid", "is", null),
    admin.from("video_seo_meta").select("uid, duration_s, mp4_status"),
  ]);
  const want = new Map<string, string | null>();
  for (const p of posts ?? []) want.set(p.video_uid, p.video_cf_code);
  for (const g of games ?? []) if (g.video_id) want.set(g.video_id, g.cf_customer_code);
  for (const d of drafts ?? []) want.set(d.video_uid, d.video_cf_code);
  for (const m of media ?? []) want.set(m.cf_uid, m.cf_code);
  const done = new Set((known ?? []).filter((k) => k.duration_s != null && k.mp4_status === "ready").map((k) => k.uid));

  let checked = 0, updated = 0;
  const errors: string[] = [];
  for (const [uid, code] of want) {
    if (!force && done.has(uid)) continue;
    checked++;
    try {
      const info = await cf(`/${uid}`);
      // A live input id (an on-air broadcast) is not a video: 404 here, retried next run.
      if (!info.ok || !info.result) { errors.push(`${uid}: info ${info.status}`); continue; }
      const v = info.result;
      const row: Record<string, unknown> = {
        uid, cf_code: code,
        duration_s: v.duration > 0 ? Math.round(v.duration * 100) / 100 : null,
        width: v.input?.width > 0 ? v.input.width : null,
        height: v.input?.height > 0 ? v.input.height : null,
        checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      if (v.readyToStream) {
        // Creates the default MP4 on first call; afterwards just reports its state.
        const dl = await cf(`/${uid}/downloads`, "POST");
        const d = dl.result?.default;
        if (d) { row.mp4_url = d.url ?? null; row.mp4_status = d.status ?? null; }
        else errors.push(`${uid}: downloads ${dl.status}`);
      }
      const { error } = await admin.from("video_seo_meta").upsert(row, { onConflict: "uid" });
      if (error) errors.push(`${uid}: ${error.message}`); else updated++;
    } catch (e) {
      errors.push(`${uid}: ${String(e).slice(0, 120)}`);
    }
  }
  return Response.json({ ok: true, checked, updated, errors });
});
