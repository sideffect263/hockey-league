// ============================================================================
// stream-golive -- mint a Cloudflare Stream live input for a game and hand its RTMPS
// ingest (URL + stream key) to an authorized streamer's app.
//
// User-facing, so it: handles CORS preflight, verifies the caller's Supabase JWT, and
// enforces can_stream_game() BEFORE creating a billable live input, inserts the public
// game_videos row (live input uid in video_id), and returns what the app publishes to.
//
// RTMP only (body `ingest: "rtmp"`). The native apps publish over RTMPS; Cloudflare
// records it and viewers watch HLS on any network; when the broadcast ends,
// `stream-replay` swaps the row from the live input to the recording. Browser (WebRTC/
// WHIP) streaming was retired 2026-10-11 -- it was never recorded, and Cloudflare began
// billing WebRTC delivery on 2026-10-15 -- so anything else gets 410 before a cent is spent.
//
// Cameras (multi-angle, 2026-10-11): every streamer in a game gets a camera_no. The same
// person going live again keeps theirs (a restart is a new PART of the same camera), a
// new person gets the next number. Optional body `camera` = a label ("מאחורי השער").
// The director (game_broadcast) can lock new streams (423) and cap simultaneous cameras
// (409); the admin is exempt from both. A camera starts hidden until the admin approves
// it (trigger game_videos_guard_hidden) -- the response's `hidden` tells the app.
//
// Secrets: CF_ACCOUNT_ID / CF_STREAM_TOKEN. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY auto-injected (service role: counting cameras the caller
// can't see -- hidden ones -- for the cap).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN")!;

const CF_API = "https://api.cloudflare.com/client/v4";

// The function self-authorizes on the JWT, so "*" is safe (Bearer-token API, not
// cookie-based). supabase-js functions.invoke() adds x-client-info (+ apikey /
// x-supabase-api-version); the browser preflight rejects any header not listed.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  let gameId: string | null = null;
  let ingest = "";
  let cameraLabel: string | null = null;
  try {
    const b = await req.json();
    gameId = (b?.gameId ?? b?.game_id ?? "").toString() || null;
    ingest = String(b?.ingest ?? "");
    cameraLabel = String(b?.camera ?? "").trim().slice(0, 40) || null;
  } catch { /* fallthrough to 400 */ }
  if (!gameId) return json({ error: "missing gameId" }, 400);
  // Browser (WHIP) streaming is retired: refuse before any Cloudflare cost.
  if (ingest !== "rtmp") return json({ error: "web streaming retired -- use the app" }, 410);

  // User-scoped client: getUser() and the RPC both run AS the caller, so the gate
  // is byte-for-byte the RLS policy (auth.uid() resolves from this JWT).
  const asUser = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { data: canStream, error: gateErr } = await asUser.rpc("can_stream_game", {
    p_game_id: gameId,
  });
  if (gateErr) {
    console.log("can_stream_game failed", gateErr.message);
    return json({ error: "gate check failed" }, 500);
  }
  if (canStream !== true) return json({ error: "forbidden" }, 403);

  // ---- Director rules (game_broadcast): lock + cap, before any Cloudflare cost.
  const svc = createClient(SB_URL, SB_SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: isAdmin } = await asUser.rpc("is_admin");
  const { data: bc } = await svc.from("game_broadcast")
    .select("max_cameras, streaming_locked").eq("game_id", gameId).maybeSingle();
  const { data: allCams } = await svc.from("game_videos")
    .select("camera_no, camera_label, created_by, video_id, cf_live_input, created_at, hidden")
    .eq("game_id", gameId).not("camera_no", "is", null);
  const mine = (allCams ?? []).find((r: any) => r.created_by === user.id);
  if (isAdmin !== true) {
    if (bc?.streaming_locked) return json({ error: "locked" }, 423);
    // Cameras on air now = rows still on their live input from the last 4h (older ones
    // are ended broadcasts nobody has swapped yet), other than the caller's own camera.
    const since = Date.now() - 4 * 3600_000;
    const onAir = new Set((allCams ?? [])
      .filter((r: any) => r.video_id === r.cf_live_input && Date.parse(r.created_at) > since &&
        r.camera_no !== mine?.camera_no)
      .map((r: any) => r.camera_no));
    if (onAir.size >= (bc?.max_cameras ?? 4)) return json({ error: "camera limit", max: bc?.max_cameras ?? 4 }, 409);
  }

  // ---- Cloudflare: create the live input. Recording is only honoured for RTMP/SRT;
  // for RTMP, a 60s timeout lets a phone that drops and reconnects keep ONE recording.
  let cf: any = null;
  let cfStatus = 0;
  try {
    const cfRes = await fetch(`${CF_API}/accounts/${CF_ACCOUNT_ID}/stream/live_inputs`, {
      method: "POST",
      headers: { authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        meta: { name: `game:${gameId}` },
        recording: { mode: "automatic", requireSignedURLs: false, timeoutSeconds: 60 },
        preferLowLatency: true,
      }),
    });
    cfStatus = cfRes.status;
    cf = await cfRes.json();
  } catch (e) {
    console.log("cloudflare fetch threw", String(e));
  }
  if (!cf?.success || !cf?.result?.uid) {
    console.log("cloudflare create live_input failed", cfStatus, JSON.stringify(cf));
    return json({ error: "cloudflare error" }, 502);
  }

  const uid: string = cf.result.uid;
  const whepUrl: string = cf.result.webRTCPlayback?.url ?? "";

  // The account's playback host is customer-<CODE>.cloudflarestream.com -- parse
  // <CODE> from the playback URL so spectators render from the row with no extra
  // config. e.g. https://customer-abc123.cloudflarestream.com/<uid>/webRTC/play
  let cfCode: string | null = null;
  try {
    cfCode = new URL(whepUrl).hostname.split(".")[0].replace(/^customer-/, "") || null;
  } catch { /* leave null -> frontend falls back to the generic host */ }

  // ---- Camera: this streamer's number in this game, else the next free one (counting
  // hidden cameras too, so a pending fan's number is never handed out twice).
  const cameraNo: number = mine?.camera_no ??
    (Math.max(0, ...(allCams ?? []).map((r: any) => r.camera_no as number)) + 1);
  // A new label wins; otherwise a returning streamer keeps the label they had.
  const label: string | null = cameraLabel ?? mine?.camera_label ?? null;

  // ---- Insert the public row so every spectator sees the embed immediately.
  // Inserted AS the user -> the can_stream_game RLS write policy is the final gate
  // and created_by is the streamer. If it fails, roll back the CF input so we
  // don't leak a billable orphan.
  const { data: row, error: insErr } = await asUser
    .from("game_videos")
    .insert({
      game_id: gameId,
      provider: "cloudflare",
      video_id: uid,
      kind: "live",
      is_primary: true,
      cf_customer_code: cfCode,
      ingest: "rtmp",
      cf_live_input: uid,
      created_by: user.id,
      camera_no: cameraNo,
      camera_label: label,
    })
    .select("id, hidden")
    .single();

  if (insErr) {
    console.log("game_videos insert failed -> deleting CF input", insErr.message);
    await fetch(`${CF_API}/accounts/${CF_ACCOUNT_ID}/stream/live_inputs/${uid}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${CF_TOKEN}` },
    }).catch(() => {});
    return json({ error: "insert failed" }, 500);
  }

  // rtmpsUrl + streamKey -> the app's encoder publishes here (the key is the secret;
  // only an authorized streamer ever receives it). No ICE: RTMPS is plain TLS/TCP 443.
  const rtmpsUrl: string = cf.result.rtmps?.url ?? "";
  const streamKey: string = cf.result.rtmps?.streamKey ?? "";
  if (!rtmpsUrl || !streamKey) {
    console.log("cloudflare live_input has no rtmps", JSON.stringify(cf.result));
    return json({ error: "cloudflare error" }, 502);
  }
  return json({
    uid,
    ingest: "rtmp",
    rtmpsUrl,
    streamKey,
    cfCustomerCode: cfCode,
    videoRowId: row.id,
    cameraNo,
    // true = waiting for the admin's approval: only the admin and this streamer see it.
    hidden: row.hidden === true,
    playerUrl: cfCode ? `https://customer-${cfCode}.cloudflarestream.com/${uid}/iframe` : null,
  });
});
