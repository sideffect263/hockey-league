// ============================================================================
// stream-audience -- who watched a game day's live streams, and for how long.
// Backs the admin tab "צפייה בשידורים" (StreamAudienceAdmin.jsx). Admin-only.
//
// POST { day: "YYYY-MM-DD" } (an Israel date) ->
//   { day, games: [{ gameId, home, away, parts, liveMinutes, liveSpanMin, avgConcurrent,
//                    peak5, peak5At, peak1, replayMinutes, people, signedIn, byPlatform,
//                    series: [{ t, v }] }], totals }
//
// Two sources, as in the 2026-10-25 report:
//  - Cloudflare Stream analytics (GraphQL streamMinutesViewedAdaptiveGroups, per video per
//    minute). Minutes viewed in one minute ~= people watching that minute. Cloudflare
//    rounds each video-minute down, so the figures run slightly low.
//  - app_events page views of a game page during each game's broadcast window: people who
//    OPENED a game page then (any game -- the app does not log which), an upper bound.
// A video's live window = game_videos.created_at .. + recorded duration (video_seo_meta).
//
// Secrets: CF_ACCOUNT_ID / CF_STREAM_TOKEN (needs Account Analytics: Read).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY auto-injected.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CF_STREAM_TOKEN")!;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const MIN = 60_000;
const GAME_PAGES = ["/games/:id", "/games/:id/tv"];

const ilDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);

async function cfGraphql(query: string, variables: Record<string, unknown>) {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.errors?.length) {
    const msg = j?.errors?.map((e: { message: string }) => e.message).join("; ") || `HTTP ${r.status}`;
    throw new Error(`cloudflare analytics: ${msg}`);
  }
  return j.data;
}

const PER_MINUTE = `query($a: string!, $f: Time!, $t: Time!, $uids: [string!]) {
  viewer { accounts(filter: {accountTag: $a}) {
    streamMinutesViewedAdaptiveGroups(limit: 10000, orderBy: [datetimeMinute_ASC],
      filter: {datetime_geq: $f, datetime_lt: $t, uid_in: $uids}) {
      sum { minutesViewed } dimensions { uid datetimeMinute }
    } } } }`;
const PER_VIDEO = `query($a: string!, $f: Time!, $t: Time!, $uids: [string!]) {
  viewer { accounts(filter: {accountTag: $a}) {
    streamMinutesViewedAdaptiveGroups(limit: 1000,
      filter: {datetime_geq: $f, datetime_lt: $t, uid_in: $uids}) {
      sum { minutesViewed } dimensions { uid }
    } } } }`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const asUser = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: isAdmin } = await asUser.rpc("is_admin");
  if (isAdmin !== true) return json({ error: "forbidden" }, 403);

  let day = "";
  try { day = String((await req.json())?.day ?? ""); } catch { /* 400 below */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day must be YYYY-MM-DD" }, 400);

  const sb = createClient(SB_URL, SB_SERVICE_ROLE, { auth: { persistSession: false } });

  // Games that day (Israel date), with a ±1 day UTC margin then filtered exactly.
  const d0 = new Date(`${day}T00:00:00Z`);
  const { data: gamesRaw, error: gErr } = await sb.from("games")
    .select("id, game_date, home_team_id, away_team_id, home_score, away_score")
    .gte("game_date", new Date(d0.getTime() - 86_400_000).toISOString())
    .lt("game_date", new Date(d0.getTime() + 2 * 86_400_000).toISOString());
  if (gErr) return json({ error: gErr.message }, 500);
  const games = (gamesRaw ?? []).filter((g) => ilDate(new Date(g.game_date)) === day);
  if (!games.length) return json({ day, games: [], totals: null });

  const { data: vids, error: vErr } = await sb.from("game_videos")
    .select("id, game_id, video_id, created_at, hidden, camera_no")
    .eq("provider", "cloudflare").in("game_id", games.map((g) => g.id));
  if (vErr) return json({ error: vErr.message }, 500);
  if (!vids?.length) return json({ day, games: [], totals: null });

  const { data: metas } = await sb.from("video_seo_meta").select("uid, duration_s")
    .in("uid", vids.map((v) => v.video_id));
  const dur = new Map((metas ?? []).map((m) => [m.uid, Number(m.duration_s) || 0]));
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]).filter(Boolean))];
  const { data: teams } = await sb.from("teams").select("id, name").in("id", teamIds);
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));

  // One broadcast part = the rows that started at the same moment: a recording can sit
  // in game_videos more than once (a re-encoded copy, e.g. with the score burned in),
  // each with its own Cloudflare uid. Viewing of any copy counts; the length comes from
  // whichever copy has one. No length yet (still on its live input) = open until now.
  const now = Date.now();
  const groups = new Map<string, { game_id: string; s: number; uids: string[]; durs: number[]; hidden: boolean; camera_no: number | null }>();
  for (const v of vids) {
    const key = `${v.game_id}|${v.created_at}`;
    const g = groups.get(key) ?? { game_id: v.game_id, s: Date.parse(v.created_at), uids: [] as string[], durs: [] as number[], hidden: true, camera_no: v.camera_no };
    g.uids.push(v.video_id);
    const d = dur.get(v.video_id);
    if (d) g.durs.push(d);
    g.hidden = g.hidden && !!v.hidden;
    groups.set(key, g);
  }
  const windows = [...groups.values()].map((g) => ({
    ...g,
    e: g.durs.length ? g.s + Math.max(...g.durs) * 1000 + 3 * MIN : Math.min(now, g.s + 4 * 3600_000),
  }));
  const uids = windows.flatMap((w) => w.uids);
  const from = new Date(Math.min(...windows.map((w) => w.s)) - 5 * MIN);
  const liveTo = new Date(Math.max(...windows.map((w) => w.e)) + 5 * MIN);

  let perMinute: Array<{ sum: { minutesViewed: number }; dimensions: { uid: string; datetimeMinute: string } }>;
  let perVideo: Array<{ sum: { minutesViewed: number }; dimensions: { uid: string } }>;
  try {
    const a = await cfGraphql(PER_MINUTE, { a: CF_ACCOUNT_ID, f: from.toISOString(), t: liveTo.toISOString(), uids });
    perMinute = a.viewer.accounts[0]?.streamMinutesViewedAdaptiveGroups ?? [];
    // Replays: everything from the first broadcast until now (Cloudflare keeps ~90 days).
    const b = await cfGraphql(PER_VIDEO, { a: CF_ACCOUNT_ID, f: from.toISOString(), t: new Date(now).toISOString(), uids });
    perVideo = b.viewer.accounts[0]?.streamMinutesViewedAdaptiveGroups ?? [];
  } catch (e) {
    console.log(String(e));
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
  const totalByUid = new Map(perVideo.map((r) => [r.dimensions.uid, r.sum.minutesViewed]));

  // App page views on a game page during the broadcast windows (paged past the 1000 cap).
  const events: Array<{ created_at: string; platform: string; user_id: string | null; session_id: string | null }> = [];
  for (let i = 0; ; i++) {
    const { data, error } = await sb.from("app_events")
      .select("created_at, platform, user_id, session_id")
      .eq("kind", "page").in("path", GAME_PAGES)
      .gte("created_at", from.toISOString()).lte("created_at", liveTo.toISOString())
      .order("created_at").range(i * 1000, i * 1000 + 999);
    if (error) return json({ error: error.message }, 500);
    events.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const out = games.map((g) => {
    const parts = windows.filter((w) => w.game_id === g.id).sort((a, b) => a.s - b.s);
    if (!parts.length) return null;
    const byMinute = new Map<number, number>();
    let live = 0;
    for (const r of perMinute) {
      const w = parts.find((p) => p.uids.includes(r.dimensions.uid));
      if (!w) continue;
      const t = Date.parse(r.dimensions.datetimeMinute);
      if (t < w.s || t > w.e) continue;
      live += r.sum.minutesViewed;
      byMinute.set(t, (byMinute.get(t) ?? 0) + r.sum.minutesViewed);
    }
    const total = parts.reduce((s, p) => s + p.uids.reduce((a, u) => a + (totalByUid.get(u) ?? 0), 0), 0);
    const span = parts.reduce((s, p) => s + Math.max(0, p.e - p.s - 3 * MIN), 0) / MIN;

    // Minute-by-minute series from first start to last end (gaps = 0).
    const start = Math.floor(parts[0].s / MIN) * MIN;
    const end = Math.max(...parts.map((p) => p.e));
    const series: Array<{ t: number; v: number }> = [];
    for (let t = start; t <= end; t += MIN) series.push({ t, v: byMinute.get(t) ?? 0 });
    let peak5 = 0, peak5At: number | null = null;
    for (let i = 0; i + 5 <= series.length; i++) {
      const avg = series.slice(i, i + 5).reduce((s, x) => s + x.v, 0) / 5;
      if (avg > peak5) { peak5 = avg; peak5At = series[i].t; }
    }

    const inWindow = events.filter((e) => {
      const t = Date.parse(e.created_at);
      return parts.some((p) => t >= p.s && t <= p.e);
    });
    const who = (e: { user_id: string | null; session_id: string | null }) => e.user_id ?? `s:${e.session_id}`;
    const people = new Set(inWindow.map(who));
    const byPlatform: Record<string, number> = {};
    for (const p of ["web", "ios", "android"]) {
      byPlatform[p] = new Set(inWindow.filter((e) => e.platform === p).map(who)).size;
    }

    return {
      gameId: g.id,
      home: teamName.get(g.home_team_id) ?? "",
      away: teamName.get(g.away_team_id) ?? "",
      homeScore: g.home_score, awayScore: g.away_score,
      parts: parts.map((p) => ({ start: new Date(p.s).toISOString(), minutes: Math.round((p.e - p.s) / MIN) - 3,
                                 hidden: p.hidden, camera: p.camera_no })),
      liveMinutes: live,
      liveSpanMin: Math.round(span),
      avgConcurrent: span ? Math.round((live / span) * 10) / 10 : 0,
      peak5: Math.round(peak5 * 10) / 10,
      peak5At: peak5At ? new Date(peak5At).toISOString() : null,
      peak1: series.reduce((m, x) => Math.max(m, x.v), 0),
      replayMinutes: Math.max(0, total - live),
      people: people.size,
      signedIn: new Set(inWindow.filter((e) => e.user_id).map((e) => e.user_id)).size,
      byPlatform,
      series,
    };
  }).filter(Boolean).sort((a, b) => a!.parts[0].start.localeCompare(b!.parts[0].start));

  const sum = (k: "liveMinutes" | "replayMinutes") => out.reduce((s, g) => s + (g ? g[k] : 0), 0);
  const allPeople = new Set(events.filter((e) => {
    const t = Date.parse(e.created_at);
    return windows.some((p) => t >= p.s && t <= p.e);
  }).map((e) => e.user_id ?? `s:${e.session_id}`));

  return json({
    day,
    games: out,
    totals: {
      liveMinutes: sum("liveMinutes"),
      replayMinutes: sum("replayMinutes"),
      peak5: Math.max(0, ...out.map((g) => g!.peak5)),
      people: allPeople.size,
    },
  });
});
