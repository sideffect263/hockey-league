// ============================================================================
// instagram-sync — copy new posts from the league's Instagram into the site feed
// (creator-posting.sql). The creator asked (2026-10-29) that whatever he posts on
// Instagram show up on the site too, without posting twice.
//
// Instagram API with Instagram Login (graph.instagram.com): needs a Business or Creator
// account and an access token for it — generated in the Meta app dashboard (Instagram →
// API setup with Instagram login → "Generate token"), no Facebook Page involved. The token
// is long-lived (60 days); every run refreshes it once it is a day old, so it never lapses
// while the sync keeps running.
//
// Actions (POST JSON):
//   { action: "connect", token, mode?, hashtag?, backfill_days? }   editor/admin → saves the account
//   { action: "sync", dry_run? }                                     cron (service key) or editor
//
// Each new Instagram post becomes a feed draft (mode 'draft' — the creator approves it in
// /creators סטודיו) or a post (mode 'live'), authored by the league account, with
// external_guid 'ig:<media id>' so nothing is imported twice and a deleted post stays deleted.
// Media is COPIED (photo → feed-photos bucket, video → Cloudflare Stream): Instagram's CDN URLs
// expire after a few days, so linking to them would leave dead images in the feed.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID") ?? "";
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN") ?? "";
const IG = "https://graph.instagram.com";

const MAX_PER_RUN = 5;            // a burst of posts trickles in over a few runs
const REFRESH_AFTER_MS = 86_400_000; // Instagram refuses to refresh a token younger than 24h

const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

type Media = {
  id: string; caption?: string; media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: string; media_url?: string; thumbnail_url?: string; permalink: string; timestamp: string;
  children?: { data: { media_type: string; media_url?: string; thumbnail_url?: string }[] };
};

async function ig(path: string, token: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${IG}/${path}?${q}`, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) throw new Error(`instagram ${path}: ${body?.error?.message ?? res.status}`);
  return body;
}

// ---- auth -------------------------------------------------------------------
async function callerIsEditor(authHeader: string): Promise<string | null> {
  const asUser = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return null;
  const [{ data: isAdmin }, { data: isEditor }] = await Promise.all([
    asUser.rpc("is_admin"), asUser.rpc("is_content_editor"),
  ]);
  return isAdmin || isEditor ? user.id : null;
}

// ---- connect ------------------------------------------------------------------
async function connect(body: any, userId: string) {
  const token = String(body?.token ?? "").trim();
  if (!token) return json({ ok: false, error: "missing_token" }, 400);
  let me;
  try { me = await ig("me", token, { fields: "user_id,username,account_type" }); }
  catch (err) { return json({ ok: false, error: "bad_token", detail: String(err) }, 400); }
  const mode = ["draft", "live", "paused"].includes(body?.mode) ? body.mode : "draft";
  const hashtag = String(body?.hashtag ?? "").replace(/^#+/, "").trim() || null;
  const days = Math.max(0, Math.min(30, Number(body?.backfill_days) || 0));
  const { error } = await admin.from("instagram_sync").upsert({
    ig_user_id: String(me.user_id ?? me.id), username: me.username, access_token: token,
    token_expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    mode, hashtag, synced_since: new Date(Date.now() - days * 86_400_000).toISOString(),
    last_error: null, connected_by: userId,
  }, { onConflict: "ig_user_id" });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, username: me.username, account_type: me.account_type });
}

// ---- sync ---------------------------------------------------------------------
async function refreshIfDue(row: any): Promise<string> {
  const expires = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  const issued = expires - 60 * 86_400_000;
  if (Date.now() - issued < REFRESH_AFTER_MS) return row.access_token;
  try {
    const r = await ig("refresh_access_token", row.access_token, { grant_type: "ig_refresh_token" });
    await admin.from("instagram_sync").update({
      access_token: r.access_token,
      token_expires_at: new Date(Date.now() + Number(r.expires_in ?? 5_184_000) * 1000).toISOString(),
    }).eq("id", row.id);
    return r.access_token;
  } catch (err) {
    console.error("token refresh failed (keeps the old one):", err);
    return row.access_token;
  }
}

function hasTag(caption: string | undefined, tag: string) {
  return new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu").test(caption ?? "");
}

// The first frame of the post: carousels use their first child.
function lead(m: Media) {
  const c = m.media_type === "CAROUSEL_ALBUM" ? m.children?.data?.[0] : null;
  const type = c ? c.media_type : m.media_type;
  return { isVideo: type === "VIDEO", url: c ? c.media_url : m.media_url, thumb: c ? c.thumbnail_url : m.thumbnail_url };
}

async function copyPhoto(url: string, mediaId: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`photo download ${res.status}`);
  const type = res.headers.get("content-type") || "image/jpeg";
  const path = `instagram/${mediaId}.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`;
  const { error } = await admin.storage.from("feed-photos")
    .upload(path, await res.arrayBuffer(), { contentType: type, upsert: true, cacheControl: "31536000" });
  if (error) throw error;
  return admin.storage.from("feed-photos").getPublicUrl(path).data.publicUrl;
}

// Cloudflare Stream pulls the file itself; the post plays once Stream has processed it (~1 min).
async function copyVideo(url: string, mediaId: string): Promise<string> {
  if (!CF_ACCOUNT_ID || !CF_TOKEN) throw new Error("cloudflare stream not configured");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/copy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ url, requireSignedURLs: false, meta: { name: `instagram ${mediaId}`, source: "instagram" } }),
  });
  const cf = await r.json().catch(() => null);
  if (!r.ok || !cf?.success) throw new Error(`stream copy: ${JSON.stringify(cf?.errors ?? r.status)}`);
  return cf.result.uid;
}

async function syncAccount(row: any, dryRun: boolean, cfCode: string | null, leagueId: string | null) {
  const token = dryRun ? row.access_token : await refreshIfDue(row);
  const list = await ig("me/media", token, {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}",
    limit: "25",
  });
  const since = new Date(row.synced_since).getTime();
  const candidates: Media[] = (list.data ?? [])
    .filter((m: Media) => new Date(m.timestamp).getTime() >= since)
    .filter((m: Media) => !row.hashtag || hasTag(m.caption, row.hashtag));
  const guids = candidates.map((m) => `ig:${m.id}`);
  const [{ data: inPosts }, { data: inDrafts }] = await Promise.all([
    admin.from("posts").select("external_guid").in("external_guid", guids),
    admin.from("feed_drafts").select("external_guid").in("external_guid", guids),
  ]);
  const seen = new Set([...(inPosts ?? []), ...(inDrafts ?? [])].map((r) => r.external_guid));
  // Oldest first, so posts land in the feed in the order they were posted.
  const todo = candidates.filter((m) => !seen.has(`ig:${m.id}`)).reverse().slice(0, MAX_PER_RUN);

  const imported: string[] = [];
  const preview: unknown[] = [];
  for (const m of todo) {
    const caption = (m.caption ?? "").trim();
    const body = (caption || "📸 חדש באינסטגרם של הליגה").slice(0, 2000);
    const l = lead(m);
    if (dryRun) { preview.push({ id: m.id, body, video: l.isVideo, permalink: m.permalink }); continue; }
    try {
      const media: Record<string, unknown> = {};
      if (l.isVideo && l.url) {
        media.video_uid = await copyVideo(l.url, m.id);
        media.video_cf_code = cfCode;
        media.video_ratio = m.media_product_type === "REELS" ? 0.5625 : 0.8;
      } else if (l.url) {
        media.image_url = await copyPhoto(l.url, m.id);
      }
      const guid = `ig:${m.id}`;
      const created_at = new Date(m.timestamp).toISOString();
      const { error } = row.mode === "live"
        ? await admin.from("posts").insert({
            author_id: leagueId, body, link_url: m.permalink, external_guid: guid, created_at, ...media })
        : await admin.from("feed_drafts").insert({
            body, external_guid: guid, source_link: m.permalink, created_by: null,
            content_type: "photo_post", outputs: ["site"], status: "ready",
            note: "מאינסטגרם — לבדוק ולפרסם", captions: { site: body },
            assets: media.image_url ? { images: [media.image_url] } : {}, ...media });
      if (error) throw error;
      imported.push(m.id);
    } catch (err) {
      console.error(`instagram ${m.id} failed:`, err);
      preview.push({ id: m.id, error: String(err) });
    }
  }
  if (!dryRun) {
    await admin.from("instagram_sync").update({
      last_run_at: new Date().toISOString(),
      last_error: preview.length ? JSON.stringify(preview).slice(0, 500) : null,
      imported_count: (row.imported_count ?? 0) + imported.length,
    }).eq("id", row.id);
  }
  return { username: row.username, mode: row.mode, candidates: candidates.length, imported, preview };
}

async function sync(dryRun: boolean) {
  const { data: rows, error } = await admin.from("instagram_sync").select("*").neq("mode", "paused");
  if (error) throw error;
  if (!rows?.length) return { ok: true, report: [], note: "no account connected" };
  const [{ data: cf }, { data: leagueId }] = await Promise.all([
    admin.from("game_videos").select("cf_customer_code").not("cf_customer_code", "is", null).limit(1).maybeSingle(),
    admin.rpc("league_account_id"),
  ]);
  const report = [];
  for (const row of rows) {
    try { report.push(await syncAccount(row, dryRun, cf?.cf_customer_code ?? null, leagueId)); }
    catch (err) {
      console.error(`${row.username} failed:`, err);
      if (!dryRun) await admin.from("instagram_sync")
        .update({ last_run_at: new Date().toISOString(), last_error: String(err).slice(0, 500) }).eq("id", row.id);
      report.push({ username: row.username, error: String(err) });
    }
  }
  return { ok: true, dry_run: dryRun, report };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const isService = authHeader === `Bearer ${SB_SERVICE}`;
    const userId = isService ? null : await callerIsEditor(authHeader);
    if (!isService && !userId) return json({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    if (body?.action === "connect") {
      if (!userId) return json({ ok: false, error: "connect needs a signed-in editor" }, 400);
      return await connect(body, userId);
    }
    if (body?.action === "sync") return json(await sync(!!body?.dry_run));
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    console.error("instagram-sync failed:", err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
