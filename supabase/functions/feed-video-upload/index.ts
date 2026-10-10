// ============================================================================
// feed-video-upload -- mint a one-time Cloudflare Stream upload URL for a FEED video post.
//
// Admin / content editor only (checked on the caller's JWT before any Cloudflare call).
// The browser then POSTs the file straight to `uploadURL` (Cloudflare "basic" direct
// creator upload, <= 200 MB) -- the file never passes through Supabase, and the Stream
// token never reaches the browser. The client creates the post with the returned uid;
// the posts_guard_video trigger re-checks the role at insert time.
//
// Body: { name?: string }   ->   { uid, uploadURL, cfCode }
// Secrets: CF_ACCOUNT_ID / CF_STREAM_TOKEN (same as stream-golive).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN")!;
const CF_API = "https://api.cloudflare.com/client/v4";
const MAX_SECONDS = 600; // a feed clip, not a game -- 10 minutes is plenty

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

  let name = "feed video";
  try { name = String((await req.json())?.name ?? name).slice(0, 120) || name; } catch { /* default */ }

  const asUser = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const [{ data: isAdmin }, { data: isEditor }] = await Promise.all([
    asUser.rpc("is_admin"), asUser.rpc("is_content_editor"),
  ]);
  if (!isAdmin && !isEditor) return json({ error: "forbidden" }, 403);

  const r = await fetch(`${CF_API}/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      maxDurationSeconds: MAX_SECONDS,
      requireSignedURLs: false,
      meta: { name, source: "feed", uploadedBy: user.id },
    }),
  });
  const cf = await r.json().catch(() => null);
  if (!r.ok || !cf?.success) {
    console.log("direct_upload failed", r.status, JSON.stringify(cf?.errors ?? cf));
    return json({ error: "cloudflare upload url failed" }, 502);
  }
  const { uid, uploadURL } = cf.result;

  // The Stream subdomain code: same account as the game recordings, so read it off any of them.
  const { data: row } = await asUser.from("game_videos").select("cf_customer_code")
    .not("cf_customer_code", "is", null).limit(1).maybeSingle();

  return json({ uid, uploadURL, cfCode: row?.cf_customer_code ?? null });
});
