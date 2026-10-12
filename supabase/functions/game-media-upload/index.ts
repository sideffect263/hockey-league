// ============================================================================
// game-media-upload -- a one-time Cloudflare Stream upload URL for footage of ONE game,
// sent by the people who were there: both teams' coaches, the game's approved officials,
// league managers, content editors, admins (public.can_contribute_game, checked on the
// caller's JWT). The upload is private raw material: it becomes a game_media row
// (origin 'upload', is_public false, status 'uploaded') that the Mac pipeline
// (video-analysis/game_pipeline.py) analyses into the game's evidence-backed timeline.
// Nothing here is shown publicly until a story cites it and is published.
//
// Body: { game_id, name?, recorded_at?, note? }  ->  { media_id, uid, uploadURL }
// The browser POSTs the file straight to uploadURL (CF basic direct upload, <= 200 MB).
// Photos don't come here: the client puts them in the private `game-media` bucket and
// inserts the row itself (RLS game_media_insert).
// Secrets: CF_ACCOUNT_ID / CF_STREAM_TOKEN (same as stream-golive). verify_jwt ON.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN")!;
const CF_API = "https://api.cloudflare.com/client/v4";
const MAX_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const gameId = String(body?.game_id ?? "");
  if (!UUID.test(gameId)) return json({ error: "game_id must be a uuid" }, 400);
  const name = String(body?.name ?? "game video").slice(0, 120);
  const note = body?.note ? String(body.note).slice(0, 500) : null;
  const recordedAt = body?.recorded_at && !Number.isNaN(Date.parse(body.recorded_at)) ? new Date(body.recorded_at).toISOString() : null;

  const asUser = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: allowed } = await asUser.rpc("can_contribute_game", { p_game_id: gameId });
  if (!allowed) return json({ error: "forbidden" }, 403);

  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: game } = await admin.from("games").select("id,status,game_date").eq("id", gameId).maybeSingle();
  if (!game) return json({ error: "no such game" }, 404);
  // Footage is of a game that has been played (or is being played) — not of a future fixture.
  if (new Date(game.game_date).getTime() > Date.now() + 2 * 3600e3) return json({ error: "game has not been played yet" }, 409);

  // Upload rate limit: 60 per user per game per day.
  const { count } = await admin.from("game_media").select("id", { count: "exact", head: true })
    .eq("game_id", gameId).eq("uploaded_by", user.id).gte("created_at", new Date(Date.now() - 864e5).toISOString());
  if ((count ?? 0) >= 60) return json({ error: "too many uploads" }, 429);

  const r = await fetch(`${CF_API}/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ maxDurationSeconds: MAX_SECONDS, requireSignedURLs: false,
      meta: { name, source: "game-media", gameId, uploadedBy: user.id } }),
  });
  const cf = await r.json().catch(() => null);
  if (!r.ok || !cf?.success) {
    console.log("direct_upload failed", r.status, JSON.stringify(cf?.errors ?? cf));
    return json({ error: "cloudflare upload url failed" }, 502);
  }
  const { uid, uploadURL } = cf.result;
  const { data: codeRow } = await admin.from("game_videos").select("cf_customer_code")
    .not("cf_customer_code", "is", null).limit(1).maybeSingle();

  const { data: row, error } = await admin.from("game_media").insert({
    game_id: gameId, kind: "video", origin: "upload", cf_uid: uid, cf_code: codeRow?.cf_customer_code ?? null,
    title: name, note, recorded_at: recordedAt, status: "uploaded", is_public: false, uploaded_by: user.id,
  }).select("id").single();
  if (error) { console.log("insert failed", error.message); return json({ error: "could not register upload" }, 500); }

  return json({ media_id: row.id, uid, uploadURL });
});
