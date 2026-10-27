// ============================================================================
// stream-recorder -- tell the 4K recorder (kookisnooki, or the Mac as backup) which broadcasts to save.
//
// Cloudflare turns every broadcast into ≤1080p for watching and recording, but it relays
// the ORIGINAL ingest untouched over its RTMPS playback endpoint. The recorder pulls that
// (ffmpeg -c copy) so the league keeps the phone's full 4K for highlights and AI tracking,
// without the phone saving anything. Verified 2026-10-27: 3840x2160 in = 3840x2160 out.
//
// POST (header x-recorder-token) -> { streams: [{ rowId, gameId, slug, gameDate, cameraNo,
//   input, connected, playUrl, playKey }] }
// Lists app (RTMP) rows still on their live input, created in the last 8 hours. Only
// `connected` inputs are worth pulling; the rest are listed so the recorder can tell a
// stream that ended from one it never saw.
//
// The playback key lets anyone watch the raw stream, so this is NOT anon: the caller must
// present a recorder token (~/.config/rinkhockey/recorder.json on each recorder machine). Only
// their SHA-256s live here — one per machine, so one can be revoked alone. Deployed with
// verify_jwt=false — the token is the auth.
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
const TOKEN_SHA256 = new Set([
  "3172a8f2c40d9ab4ea24e320e805e90b4650fcf805cb7fd9b8db4081e44863af", // mac (backup)
  "6a7535c080458adf994def70b8ceb87a86f9c36a156846a62a093130b2b38254", // kookisnooki
]);

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const token = req.headers.get("x-recorder-token") ?? "";
  if (!token || !TOKEN_SHA256.has(await sha256(token))) return json({ error: "forbidden" }, 403);

  const since = new Date(Date.now() - 8 * 3600_000).toISOString();
  const { data: rows, error } = await admin
    .from("game_videos")
    .select("id, game_id, camera_no, video_id, cf_live_input, created_at, game:games(slug, game_date)")
    .eq("provider", "cloudflare")
    .eq("ingest", "rtmp")
    .not("cf_live_input", "is", null)
    .gte("created_at", since)
    .order("created_at");
  if (error) {
    console.log("game_videos read failed", error.message);
    return json({ error: "db" }, 500);
  }

  // A row stays on its input while on air; stream-replay swaps it to the recording after.
  const onInput = (rows ?? []).filter((r: any) => r.video_id === r.cf_live_input);
  const streams = await Promise.all(onInput.map(async (r: any) => {
    const res = await fetch(`${CF_API}/accounts/${CF_ACCOUNT_ID}/stream/live_inputs/${r.cf_live_input}`, {
      headers: { authorization: `Bearer ${CF_TOKEN}` },
    });
    const cf = await res.json().catch(() => null);
    const x = cf?.result;
    return {
      rowId: r.id,
      gameId: r.game_id,
      slug: r.game?.slug ?? null,
      gameDate: r.game?.game_date ?? null,
      cameraNo: r.camera_no,
      input: r.cf_live_input,
      connected: x?.status?.current?.state === "connected",
      playUrl: x?.rtmpsPlayback?.url ?? null,
      playKey: x?.rtmpsPlayback?.streamKey ?? null,
    };
  }));
  return json({ streams });
});
