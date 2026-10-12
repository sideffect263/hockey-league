// game-story — the server half of "סיפור המשחק" (a written story for each finished game).
//
// A Claude cloud routine (scripts/game-story/ROUTINE.md) does the writing:
//   1. POST {action:"queue"}            → finished games that have no story yet (newest first)
//   2. POST {action:"bundle", game_id}  → everything true about that game: score, halftime,
//                                          scorers, cards, MVP, table before/after, form, head-to-
//                                          head, plus its media (highlight videos as frame URLs,
//                                          photos) — the routine LOOKS at the frames itself
//   3. POST {action:"save", game_id,…}  → stores the story as a DRAFT
// A content editor / admin then reviews, edits and publishes it in /creators. Nothing this
// function writes is ever public on its own (game_stories RLS: anon reads published only).
//
// Why a function and not the service-role key in the routine: same as weekly-preview — the
// routine runs in a cloud environment we don't control, so this token can do exactly one
// thing: read public game facts and write a draft story. Auth: Bearer <GAME_STORY_TOKEN>.
// verify_jwt is off; the token check below is the whole gate.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("GAME_STORY_TOKEN") ?? "";
const SITE = "https://rinkhockeyil.com";
const TZ = "Asia/Jerusalem";

const admin = createClient(SB_URL, SB_SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const played = (g: any) => g.status === "completed" && g.home_score != null && g.away_score != null;

function localDate(iso: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, weekday: p.weekday };
}

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** The box score a story is written from — if it changes later, the story is stale. */
async function factsHash(g: any, stats: any[]) {
  const s = stats.map((r) => `${r.player_id}:${r.goals}:${r.blue_cards}:${r.red_cards}`).sort().join("|");
  return sha(`${g.home_score}-${g.away_score}-${g.home_own_goals ?? 0}-${g.away_own_goals ?? 0}|${s}`);
}

// ---- media ------------------------------------------------------------------
// Cloudflare Stream: a frame at any second is a plain GET — no download, no ffmpeg.
const cfBase = (code: string, uid: string) => `https://customer-${code}.cloudflarestream.com/${uid}`;
const frameUrl = (code: string, uid: string, sec: number) => `${cfBase(code, uid)}/thumbnails/thumbnail.jpg?time=${sec}s&height=720`;

async function videoDuration(code: string, uid: string): Promise<number | null> {
  // The HLS manifest lists segment durations; summing them is the cheapest exact length.
  try {
    const master = await (await fetch(`${cfBase(code, uid)}/manifest/video.m3u8`)).text();
    const variant = master.split("\n").find((l) => l && !l.startsWith("#"));
    if (!variant) return null;
    const url = new URL(variant, `${cfBase(code, uid)}/manifest/video.m3u8`).toString();
    const pl = await (await fetch(url)).text();
    const secs = [...pl.matchAll(/#EXTINF:([\d.]+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    return secs > 0 ? Math.round(secs) : null;
  } catch { return null; }
}

/** Evenly spaced frame URLs across a clip (skipping the very first/last second). */
function framesFor(code: string, uid: string, duration: number | null, n: number) {
  const d = duration ?? 20;
  const out: { second: number; url: string }[] = [];
  for (let i = 1; i <= n; i++) {
    const sec = Math.max(1, Math.round((d * i) / (n + 1)));
    if (!out.some((f) => f.second === sec)) out.push({ second: sec, url: frameUrl(code, uid, sec) });
  }
  return out;
}

// ---- queue ------------------------------------------------------------------
async function queue(limit: number) {
  const [{ data: games, error }, { data: stories }] = await Promise.all([
    admin.from("games").select("id,slug,game_date,status,home_score,away_score,is_test,season_id,tournament_id")
      .eq("status", "completed").eq("is_test", false).not("home_score", "is", null).order("game_date", { ascending: false }),
    admin.from("game_stories").select("game_id"),
  ]);
  if (error) throw error;
  const have = new Set((stories ?? []).map((s: any) => s.game_id));
  const todo = (games ?? []).filter((g: any) => !have.has(g.id));
  // Games with media first — they make the best stories and are the newest anyway.
  const { data: media } = await admin.from("posts").select("game_id").in("game_id", todo.map((g: any) => g.id)).is("deleted_at", null);
  const withMedia = new Set((media ?? []).map((p: any) => p.game_id));
  todo.sort((a: any, b: any) => (Number(withMedia.has(b.id)) - Number(withMedia.has(a.id))) || String(b.game_date).localeCompare(String(a.game_date)));
  return { total_missing: todo.length, games: todo.slice(0, limit).map((g: any) => ({ id: g.id, slug: g.slug, date: localDate(g.game_date).date, has_media: withMedia.has(g.id) })) };
}

// ---- bundle -----------------------------------------------------------------
async function bundle(gameId: string) {
  const { data: g, error } = await admin.from("games").select("*").eq("id", gameId).maybeSingle();
  if (error) throw error;
  if (!g || g.is_test) return { ok: false, error: "no such game" };
  if (!played(g)) return { ok: false, error: "game is not completed" };

  const [{ data: season }, { data: seasonGames }, { data: stats }, { data: report }, { data: posts }, { data: videos }, { data: story }] = await Promise.all([
    g.season_id ? admin.from("seasons").select("id,name,status").eq("id", g.season_id).maybeSingle() : Promise.resolve({ data: null }),
    g.season_id ? admin.from("games").select("id,game_date,status,home_team_id,away_team_id,home_score,away_score,game_type,is_test").eq("season_id", g.season_id).eq("is_test", false)
      : Promise.resolve({ data: [] }),
    admin.from("game_stats").select("player_id,goals,blue_cards,red_cards,clean_sheet,played_for_team_id,is_guest_player,guest_player_name").eq("game_id", gameId),
    admin.from("game_reports").select("halftime_home,halftime_away,home_fouls,away_fouls,timeouts,events").eq("game_id", gameId).maybeSingle(),
    admin.from("posts").select("id,body,image_url,video_uid,video_cf_code,created_at,source_name").eq("game_id", gameId).is("deleted_at", null).order("created_at"),
    admin.from("game_videos").select("id,provider,video_id,cf_customer_code,kind,title,hidden").eq("game_id", gameId).eq("hidden", false),
    admin.from("game_stories").select("status").eq("game_id", gameId).maybeSingle(),
  ]);

  // Names as they were THAT season (teams get renamed; the archive keeps the old name).
  const teamIds = [g.home_team_id, g.away_team_id];
  const [{ data: teams }, { data: seasonNames }] = await Promise.all([
    admin.from("teams").select("id,name,city,home_venue,slug").in("id", teamIds),
    g.season_id ? admin.from("team_season_stats").select("team_id,team_name,final_rank").eq("season_id", g.season_id) : Promise.resolve({ data: [] }),
  ]);
  const seasonName = (id: string) => (seasonNames ?? []).find((t: any) => t.team_id === id)?.team_name;
  const team = (id: string) => {
    const t = (teams ?? []).find((x: any) => x.id === id) ?? {};
    return { id, name: seasonName(id) || t.name, city: t.city ?? null, url: t.slug ? `${SITE}/teams/${encodeURIComponent(t.slug)}` : null };
  };
  const home = team(g.home_team_id), away = team(g.away_team_id);

  // Players in the box score (+ the MVP), with their season goals up to and including this game.
  const pids = [...new Set([...(stats ?? []).map((s: any) => s.player_id), g.mvp_player_id].filter(Boolean))];
  const { data: players } = pids.length
    ? await admin.from("players").select("id,first_name,last_name,jersey_number,position,team_id,slug").in("id", pids)
    : { data: [] };
  const pById = Object.fromEntries((players ?? []).map((p: any) => [p.id, p]));
  const sgIds = (seasonGames ?? []).filter((x: any) => played(x) && x.game_date <= g.game_date).map((x: any) => x.id);
  const { data: seasonStats } = pids.length && sgIds.length
    ? await admin.from("game_stats").select("player_id,goals,game_id").in("player_id", pids).in("game_id", sgIds)
    : { data: [] };
  const seasonGoals = (pid: string) => (seasonStats ?? []).filter((r: any) => r.player_id === pid).reduce((n: number, r: any) => n + (r.goals || 0), 0);
  const side = (s: any) => {
    const t = s.played_for_team_id || pById[s.player_id]?.team_id;
    return t === g.home_team_id ? "home" : t === g.away_team_id ? "away" : null;
  };
  const playerLine = (s: any) => {
    const p = pById[s.player_id];
    return {
      name: s.is_guest_player ? (s.guest_player_name || "שחקן אורח") : p ? `${p.first_name} ${p.last_name}`.trim() : "שחקן",
      jersey: p?.jersey_number ?? null, position: p?.position === "Goalkeeper" ? "שוער" : "שחקן שדה",
      goals: s.goals || 0, blue_cards: s.blue_cards || 0, red_cards: s.red_cards || 0, clean_sheet: !!s.clean_sheet,
      season_goals_after_this_game: s.player_id ? seasonGoals(s.player_id) : null,
      url: p?.slug ? `${SITE}/players/${encodeURIComponent(p.slug)}` : null,
    };
  };
  const box = (k: "home" | "away") => (stats ?? []).filter((s: any) => side(s) === k).map(playerLine)
    .filter((p: any) => p.goals || p.blue_cards || p.red_cards || p.clean_sheet).sort((a: any, b: any) => b.goals - a.goals);

  // Table before and after this game (league games of the season, by date).
  const league = (seasonGames ?? []).filter((x: any) => played(x) && x.game_type !== "ידידותי");
  const table = (upTo: (x: any) => boolean) => {
    const t: Record<string, any> = {};
    for (const x of league.filter(upTo)) {
      for (const [id, gf, ga] of [[x.home_team_id, x.home_score, x.away_score], [x.away_team_id, x.away_score, x.home_score]] as const) {
        const r = (t[id] ??= { team: team(id).name ?? id, team_id: id, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
        r.played++; r.gf += gf; r.ga += ga;
        if (gf > ga) { r.w++; r.pts += 3; } else if (gf === ga) { r.d++; r.pts += 1; } else r.l++;
      }
    }
    return Object.values(t).sort((a: any, b: any) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)
      .map((r: any, i: number) => ({ rank: i + 1, ...r }));
  };
  const before = table((x) => x.game_date < g.game_date);
  const after = table((x) => x.game_date <= g.game_date);
  const rankOf = (tbl: any[], id: string) => tbl.find((r) => r.team_id === id)?.rank ?? null;

  const form = (id: string) => league.filter((x: any) => x.game_date < g.game_date && (x.home_team_id === id || x.away_team_id === id))
    .sort((a: any, b: any) => String(b.game_date).localeCompare(String(a.game_date))).slice(0, 5)
    .map((x: any) => {
      const mine = x.home_team_id === id ? x.home_score : x.away_score, theirs = x.home_team_id === id ? x.away_score : x.home_score;
      return { date: localDate(x.game_date).date, opponent: team(x.home_team_id === id ? x.away_team_id : x.home_team_id).name, score: `${mine}-${theirs}`, result: mine > theirs ? "W" : mine < theirs ? "L" : "D" };
    });

  // Every earlier meeting of these two clubs, any season.
  const { data: h2hRaw } = await admin.from("games").select("game_date,home_team_id,away_team_id,home_score,away_score,status,is_test")
    .or(`and(home_team_id.eq.${g.home_team_id},away_team_id.eq.${g.away_team_id}),and(home_team_id.eq.${g.away_team_id},away_team_id.eq.${g.home_team_id})`)
    .lt("game_date", g.game_date).eq("status", "completed").eq("is_test", false).order("game_date", { ascending: false }).limit(10);
  const h2h = (h2hRaw ?? []).map((x: any) => ({ date: localDate(x.game_date).date, home: team(x.home_team_id).name, away: team(x.away_team_id).name, score: `${x.home_score}-${x.away_score}` }));

  // Media. Highlight videos → frame URLs the routine fetches and looks at.
  const media: any[] = [];
  for (const p of posts ?? []) {
    const item: any = { post_id: p.id, text: String(p.body || "").slice(0, 600), posted_at: p.created_at, url: `${SITE}/posts/${p.id}` };
    if (p.image_url) item.image_url = p.image_url;
    if (p.video_uid && p.video_cf_code) {
      const dur = await videoDuration(p.video_cf_code, p.video_uid);
      item.video = { duration_seconds: dur, frames: framesFor(p.video_cf_code, p.video_uid, dur, 6) };
    }
    if (item.image_url || item.video) media.push(item);
  }
  // Full-game recordings: a few wide frames (atmosphere, the rink) — never a goal moment.
  const recordings = [];
  for (const v of videos ?? []) {
    if (v.provider !== "cloudflare" || !v.cf_customer_code || !v.video_id) continue;
    const dur = await videoDuration(v.cf_customer_code, v.video_id);
    recordings.push({ title: v.title, duration_seconds: dur, frames: framesFor(v.cf_customer_code, v.video_id, dur, 4) });
  }

  const when = localDate(g.game_date);
  const mvp = g.mvp_player_id && pById[g.mvp_player_id] ? `${pById[g.mvp_player_id].first_name} ${pById[g.mvp_player_id].last_name}`.trim() : null;
  const facts = {
    game_id: g.id, url: g.slug ? `${SITE}/games/${encodeURIComponent(g.slug)}` : null,
    season: season?.name ?? null, season_status: season?.status ?? null,
    date: when.date, weekday: when.weekday, time: when.time, venue: g.venue,
    game_type: g.game_type, playoff_round: g.playoff_round, series_game: g.series_game,
    technical_loss: !!g.is_technical_loss, neutral_venue: !!g.is_neutral,
    home, away,
    score: { home: g.home_score, away: g.away_score },
    halftime: report && report.halftime_home != null ? { home: report.halftime_home, away: report.halftime_away } : null,
    fouls: report && report.home_fouls != null ? { home: report.home_fouls, away: report.away_fouls } : null,
    own_goals: { scored_for_home: g.home_own_goals ?? 0, scored_for_away: g.away_own_goals ?? 0 },
    clean_sheet: { home: !!g.home_clean_sheet, away: !!g.away_clean_sheet },
    mvp,
    box_score: { home: box("home"), away: box("away"), recorded: (stats ?? []).length > 0 },
    table_before: before, table_after: after,
    rank_change: { home: [rankOf(before, g.home_team_id), rankOf(after, g.home_team_id)], away: [rankOf(before, g.away_team_id), rankOf(after, g.away_team_id)] },
    form_before: { home: form(g.home_team_id), away: form(g.away_team_id) },
    head_to_head: h2h,
    media, recordings,
  };
  return { ok: true, existing_story_status: story?.status ?? null, facts_hash: await factsHash(g, stats ?? []), facts };
}

// ---- save -------------------------------------------------------------------
async function save(body: any) {
  const gameId = String(body?.game_id ?? "");
  if (!UUID.test(gameId)) return { ok: false, error: "game_id must be a uuid" };
  const title = String(body?.title ?? "").trim();
  const summary = String(body?.summary ?? "").trim();
  const text = String(body?.body ?? "").replace(/\r/g, "").trim();
  if (title.length < 8 || title.length > 120) return { ok: false, error: "title must be 8-120 chars" };
  if (summary.length < 40 || summary.length > 220) return { ok: false, error: "summary must be 40-220 chars" };
  if (text.length < 300 || text.length > 5000) return { ok: false, error: "body must be 300-5000 chars" };
  if (/[<>]/.test(title + summary + text)) return { ok: false, error: "no HTML" };

  const b = await bundle(gameId);
  if (!b.ok) return b;
  const facts: any = (b as any).facts;
  // Media must be this game's own — a hero image or a moment from another game is a lie.
  const ownPosts = new Set(facts.media.map((m: any) => m.post_id));
  const ownImages = new Set<string>([
    ...facts.media.flatMap((m: any) => [m.image_url, ...(m.video?.frames ?? []).map((f: any) => f.url)]).filter(Boolean),
    ...facts.recordings.flatMap((r: any) => r.frames.map((f: any) => f.url)),
  ]);
  const ownImagePrefixes = [...ownImages].map((u) => u.split("/thumbnails/")[0]).filter((u) => u.includes("cloudflarestream.com"));
  const hero = body?.hero_image_url ? String(body.hero_image_url) : null;
  if (hero && !ownImages.has(hero) && !ownImagePrefixes.some((p) => hero.startsWith(`${p}/thumbnails/thumbnail.jpg?`))) {
    return { ok: false, error: "hero_image_url must be one of this game's media URLs (an image_url or a frame of its videos)" };
  }
  const moments = Array.isArray(body?.moments) ? body.moments.slice(0, 8).map((m: any) => ({
    label: String(m?.label ?? "").slice(0, 40), text: String(m?.text ?? "").slice(0, 400),
    ...(m?.post_id && ownPosts.has(m.post_id) ? { post_id: m.post_id } : {}),
  })).filter((m: any) => m.text) : [];
  const usedPosts = (Array.isArray(body?.media_post_ids) ? body.media_post_ids : []).filter((id: any) => ownPosts.has(id));

  const { data: existing } = await admin.from("game_stories").select("status").eq("game_id", gameId).maybeSingle();
  if (existing?.status === "published" && !body?.replace_published) {
    return { ok: false, error: "a published story exists — pass replace_published:true only when asked to rewrite it" };
  }
  if (body?.dry_run) return { ok: true, dry_run: true, would_save: { title, summary, chars: text.length, moments: moments.length, hero } };

  const row = {
    game_id: gameId, status: "draft", title, summary, body: text, moments, hero_image_url: hero,
    media_post_ids: usedPosts, facts_hash: b.facts_hash, generated_at: new Date().toISOString(),
    generated_by: String(body?.generated_by ?? "routine").slice(0, 60), published_at: null, published_by: null,
  };
  const { error } = await admin.from("game_stories").upsert(row, { onConflict: "game_id" });
  if (error) throw error;
  return { ok: true, saved: { game_id: gameId, status: "draft", title }, review_url: `${SITE}/creators?tab=stories` };
}

Deno.serve(async (req) => {
  try {
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!TOKEN || bearer !== TOKEN) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    if (body?.action === "queue") return Response.json({ ok: true, ...(await queue(Math.min(Math.max(Number(body?.limit) || 5, 1), 60))) });
    if (body?.action === "bundle") {
      if (!UUID.test(String(body?.game_id ?? ""))) return Response.json({ ok: false, error: "game_id must be a uuid" }, { status: 400 });
      const r = await bundle(body.game_id);
      return Response.json(r, { status: r.ok ? 200 : 404 });
    }
    if (body?.action === "save") {
      const r = await save(body);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    return Response.json({ ok: false, error: "action must be queue|bundle|save" }, { status: 400 });
  } catch (e) {
    console.error("game-story failed", e);
    return Response.json({ ok: false, error: String((e as any)?.message ?? e) }, { status: 500 });
  }
});
