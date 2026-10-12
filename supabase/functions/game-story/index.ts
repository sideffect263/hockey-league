// game-story — the server half of "סיפור המשחק" (a written story for each finished game).
//
// A Claude cloud routine (scripts/game-story/ROUTINE.md) does the writing:
//   1. POST {action:"queue"}            → finished games that have no story yet (newest first)
//   2. POST {action:"bundle", game_id}  → everything true about that game: score, halftime,
//                                          scorers, cards, MVP, table before/after, form, head-to-
//                                          head, plus its media (highlight videos as frame URLs,
//                                          photos) — the routine LOOKS at the frames itself
//   3. POST {action:"save", game_id,…}  → stores the story as a DRAFT
// v2 (2026-10-12): the story is a TIMELINE of beats, and every beat cites its evidence —
// game_events (the judge's clock, the referee form, editor-confirmed moments), game_media (the
// stream recording, clips the Mac pipeline cut, coach/official uploads) or named facts (box
// score, table…). save() rejects a beat that cites nothing or cites what isn't this game's,
// marks each beat verified / not, and applies the league's publish mode (league_settings
// game_story_publish_mode: review → verified → auto, switched by an admin in /creators).
// A story that is already live gets a pending_revision instead of being overwritten (unless
// the mode is 'auto').
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
// A game needs (re)writing when it has no story, or when evidence arrived after the story was
// written: new/updated media, judge events, or a changed box score. Rejected stories stay put.
async function queue(limit: number) {
  const [{ data: games, error }, { data: stories }, { data: media }, { data: events }] = await Promise.all([
    admin.from("games").select("id,slug,game_date,status,home_score,away_score,is_test")
      .eq("status", "completed").eq("is_test", false).not("home_score", "is", null).order("game_date", { ascending: false }),
    admin.from("game_stories").select("game_id,status,generated_at,pending_revision,timeline"),
    admin.from("game_media").select("game_id,updated_at,status").neq("status", "error"),
    admin.from("game_events").select("game_id,updated_at"),
  ]);
  if (error) throw error;
  const storyOf = new Map((stories ?? []).map((st: any) => [st.game_id, st]));
  const latest = (rows: any[] | null, id: string) => (rows ?? []).filter((r) => r.game_id === id).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
  const pendingMedia = new Set((media ?? []).filter((m: any) => m.status === "uploaded" || m.status === "processing").map((m: any) => m.game_id));
  const out: any[] = [];
  for (const g of games ?? []) {
    const st: any = storyOf.get(g.id);
    if (st?.status === "rejected") continue;
    const writtenAt = st?.pending_revision?.generated_at || st?.generated_at || "";
    const newEvidence = st && (latest(media, g.id) > writtenAt || latest(events, g.id) > writtenAt);
    // A draft from before timelines (v1, plain prose) is rewritten as a timeline.
    const upgrade = st && st.status === "draft" && !(Array.isArray(st.timeline) && st.timeline.length);
    if (st && !newEvidence && !upgrade) continue;
    out.push({ id: g.id, slug: g.slug, date: localDate(g.game_date).date, reason: !st ? "no_story" : upgrade ? "upgrade" : "new_evidence",
      has_media: (media ?? []).some((m: any) => m.game_id === g.id), media_still_processing: pendingMedia.has(g.id) });
  }
  // New evidence first (a live story is out of date), then games with media, newest first.
  out.sort((a, b) => (Number(b.reason === "new_evidence") - Number(a.reason === "new_evidence")) || (Number(b.has_media) - Number(a.has_media)) || b.date.localeCompare(a.date));
  return { total: out.length, games: out.slice(0, limit) };
}

// Every game-linked post with a video/photo and every stream recording becomes a game_media
// row, so a beat can cite it by id. Idempotent.
async function ensureMediaRows(gameId: string, posts: any[], videos: any[]) {
  const rows: any[] = [];
  for (const p of posts) {
    if (!p.video_uid && !p.image_url) continue;
    rows.push({ game_id: gameId, kind: p.video_uid ? "video" : "image", origin: "post", post_id: p.id,
      cf_uid: p.video_uid ?? null, cf_code: p.video_cf_code ?? null, public_url: p.video_uid ? null : p.image_url,
      title: String(p.body || "").split("\n")[0].slice(0, 120), status: "ready", is_public: true, recorded_at: null });
  }
  if (rows.length) await admin.from("game_media").upsert(rows, { onConflict: "post_id", ignoreDuplicates: true });
  const recs = videos.filter((v: any) => v.provider === "cloudflare" && v.cf_customer_code && v.video_id).map((v: any) => ({
    game_id: gameId, kind: "video", origin: "recording", game_video_id: v.id, cf_uid: v.video_id, cf_code: v.cf_customer_code,
    title: v.title || (v.camera_label ? `שידור · ${v.camera_label}` : "שידור המשחק"), recorded_at: v.created_at,
    status: "uploaded", is_public: true,
  }));
  if (recs.length) await admin.from("game_media").upsert(recs, { onConflict: "game_video_id", ignoreDuplicates: true });
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
    admin.from("game_reports").select("halftime_home,halftime_away,home_fouls,away_fouls,timeouts,period_ms").eq("game_id", gameId).maybeSingle(),
    admin.from("posts").select("id,body,image_url,video_uid,video_cf_code,created_at,source_name").eq("game_id", gameId).is("deleted_at", null).order("created_at"),
    admin.from("game_videos").select("id,provider,video_id,cf_customer_code,kind,title,hidden,camera_label,created_at").eq("game_id", gameId).eq("hidden", false),
    admin.from("game_stories").select("status,version,pending_revision").eq("game_id", gameId).maybeSingle(),
  ]);
  await ensureMediaRows(gameId, posts ?? [], videos ?? []);

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

  // ── The event log (game_events): the timeline's spine. Score after each goal, game time.
  const periodMs = report?.period_ms || 25 * 60e3;
  const { data: evRows } = await admin.from("game_events")
    .select("id,kind,side,player_id,player_name,own_goal,period,clock_ms,wall_at,source,status,note")
    .eq("game_id", gameId).neq("status", "rejected");
  const ord = (e: any) => ({ "1": 1, "2": 2, "3": 3, "הארכה 1": 4, "הארכה 2": 5 } as any)[e.period ?? ""] * 1e8 - (e.clock_ms ?? 0);
  let sh = 0, sa = 0;
  const events = (evRows ?? []).sort((a: any, b: any) => (ord(a) - ord(b)) || String(a.wall_at).localeCompare(String(b.wall_at))).map((e: any) => {
    if (e.kind === "goal" && e.status === "confirmed") { if (e.side === "home") sh++; else if (e.side === "away") sa++; }
    const elapsed = e.clock_ms != null ? Math.max(0, periodMs - e.clock_ms) : null;
    return {
      event_id: e.id, kind: e.kind, side: e.side, team: e.side === "home" ? home.name : e.side === "away" ? away.name : null,
      player: e.player_id && pById[e.player_id] ? `${pById[e.player_id].first_name} ${pById[e.player_id].last_name}`.trim() : e.player_name,
      own_goal: e.own_goal, period: e.period,
      game_time: elapsed != null ? `${String(Math.floor(elapsed / 60000)).padStart(2, "0")}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, "0")}` : null,
      score_after: e.kind === "goal" && e.status === "confirmed" ? { home: sh, away: sa } : null,
      wall_at: e.wall_at, source: e.source, status: e.status, note: e.note,
    };
  });
  // Events whose player is not in the box score lookup still need a name; fetch any missing.
  const missing = [...new Set((evRows ?? []).map((e: any) => e.player_id).filter((id: string) => id && !pById[id]))];
  if (missing.length) {
    const { data: more } = await admin.from("players").select("id,first_name,last_name").in("id", missing);
    for (const p of more ?? []) for (const ev of events) if ((evRows ?? []).find((r: any) => r.id === ev.event_id)?.player_id === p.id) ev.player = `${p.first_name} ${p.last_name}`.trim();
  }

  // ── Media (game_media): everything filmed or photographed at this game, with what the Mac
  // pipeline found in it. Videos come with frame URLs the writer downloads and LOOKS at.
  const { data: mediaRows } = await admin.from("game_media")
    .select("id,kind,origin,cf_uid,cf_code,storage_path,public_url,parent_id,post_id,event_id,clip_start_s,clip_end_s,title,note,recorded_at,duration_s,status,analysis,is_public,game_video_id")
    .eq("game_id", gameId).neq("status", "error").order("created_at");
  const media: any[] = [];
  for (const m of mediaRows ?? []) {
    const item: any = { media_id: m.id, kind: m.kind, origin: m.origin, title: m.title, note: m.note,
      event_id: m.event_id, parent_media_id: m.parent_id, clip: m.clip_start_s != null ? { start_s: m.clip_start_s, end_s: m.clip_end_s } : null,
      recorded_at: m.recorded_at, status: m.status, public: m.is_public,
      caption: m.post_id ? String((posts ?? []).find((p: any) => p.id === m.post_id)?.body || "").slice(0, 600) : null,
      findings: m.analysis?.moments ?? null, transcript: m.analysis?.speech ?? null };
    if (m.kind === "video" && m.cf_uid && m.cf_code) {
      const dur = m.duration_s ?? (m.origin === "recording" ? null : await videoDuration(m.cf_code, m.cf_uid));
      item.duration_s = dur;
      // Recordings are long: frames only where the pipeline found something, plus a few wide shots.
      const findingFrames = (m.analysis?.moments ?? []).slice(0, 12).map((x: any) => ({ second: Math.round(x.t), url: frameUrl(m.cf_code, m.cf_uid, Math.max(1, Math.round(x.t))), why: x.kind }));
      item.frames = m.origin === "recording" ? [...findingFrames, ...framesFor(m.cf_code, m.cf_uid, dur, 4)] : (m.analysis?.frames?.length ? m.analysis.frames.map((t: number) => ({ second: t, url: frameUrl(m.cf_code, m.cf_uid, t) })) : framesFor(m.cf_code, m.cf_uid, dur, 6));
      item.frame_url_template = frameUrl(m.cf_code, m.cf_uid, 0).replace("time=0s", "time={SECOND}s");
    } else if (m.kind === "image") {
      item.image_url = m.public_url || (m.storage_path ? (await admin.storage.from("game-media").createSignedUrl(m.storage_path, 3600)).data?.signedUrl : null);
    }
    media.push(item);
  }
  const recordings = media.filter((m) => m.origin === "recording");
  const { data: modeRow } = await admin.from("league_settings").select("value").eq("key", "game_story_publish_mode").maybeSingle();

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
    events, media,
  };
  return { ok: true, existing_story_status: story?.status ?? null, existing_story_version: story?.version ?? null,
    publish_mode: modeRow?.value ?? "review", facts_hash: await factsHash(g, stats ?? []), facts, _recordings: recordings.length };
}

// ---- save -------------------------------------------------------------------
const STAT_KEYS = new Set(["score", "halftime", "fouls", "box_score", "mvp", "table", "form", "head_to_head", "clean_sheet", "own_goals", "season"]);
const BEAT_KINDS = new Set(["intro", "event", "context", "closing"]);
const HARD_SOURCES = new Set(["judge", "form", "editor", "box"]);

async function save(body: any) {
  const gameId = String(body?.game_id ?? "");
  if (!UUID.test(gameId)) return { ok: false, error: "game_id must be a uuid" };
  const title = String(body?.title ?? "").trim();
  const summary = String(body?.summary ?? "").trim();
  if (title.length < 8 || title.length > 120) return { ok: false, error: "title must be 8-120 chars" };
  if (summary.length < 40 || summary.length > 220) return { ok: false, error: "summary must be 40-220 chars" };
  const beatsIn = Array.isArray(body?.timeline) ? body.timeline : [];
  if (beatsIn.length < 2 || beatsIn.length > 30) return { ok: false, error: "timeline must have 2-30 beats" };

  const b: any = await bundle(gameId);
  if (!b.ok) return b;
  const evById = new Map(b.facts.events.map((e: any) => [e.event_id, e]));
  const mediaById = new Map(b.facts.media.map((m: any) => [m.media_id, m]));

  const errors: string[] = [];
  const timeline = beatsIn.map((x: any, i: number) => {
    const n = i + 1;
    const kind = BEAT_KINDS.has(x?.kind) ? x.kind : "context";
    const text = String(x?.text ?? "").replace(/\r/g, "").trim();
    if (text.length < 20 || text.length > 700) errors.push(`beat ${n}: text must be 20-700 chars`);
    if (/[<>]/.test(text)) errors.push(`beat ${n}: no HTML`);
    const eventIds = (Array.isArray(x?.event_ids) ? x.event_ids : []).map(String);
    for (const id of eventIds) if (!evById.has(id)) errors.push(`beat ${n}: event ${id} is not one of this game's events`);
    const stats = (Array.isArray(x?.stats) ? x.stats : []).map(String);
    for (const k of stats) if (!STAT_KEYS.has(k)) errors.push(`beat ${n}: unknown stat "${k}"`);
    const media = (Array.isArray(x?.media) ? x.media : []).slice(0, 4).map((m: any) => {
      const src: any = mediaById.get(String(m?.media_id));
      if (!src) { errors.push(`beat ${n}: media ${m?.media_id} is not this game's`); return null; }
      const at = m?.at_s != null ? Number(m.at_s) : null;
      if (at != null && src.duration_s && (at < 0 || at > src.duration_s)) errors.push(`beat ${n}: at_s ${at} outside the video`);
      return { media_id: src.media_id, kind: src.kind, ...(at != null ? { at_s: at } : {}),
        ...(m?.start_s != null ? { start_s: Number(m.start_s), end_s: Number(m.end_s ?? Number(m.start_s) + 12) } : {}),
        ...(m?.caption ? { caption: String(m.caption).slice(0, 200) } : {}) };
    }).filter(Boolean);
    if (kind === "event" && !eventIds.length && !media.length) errors.push(`beat ${n}: an event beat must cite an event or a clip`);
    if (!eventIds.length && !stats.length && !media.length) errors.push(`beat ${n}: cites no evidence`);
    // Verified = rests on hard evidence: a confirmed event from the judge/form/editor/box, or named facts.
    const hardEvents = eventIds.length > 0 && eventIds.every((id: string) => { const e: any = evById.get(id); return e?.status === "confirmed" && HARD_SOURCES.has(e.source); });
    const verified = kind === "event" ? hardEvents : (stats.length > 0 || hardEvents);
    const first: any = eventIds.length ? evById.get(eventIds[0]) : null;
    return {
      id: `b${n}`, kind, title: String(x?.title ?? "").trim().slice(0, 60), text, event_ids: eventIds, stats, media, verified,
      ...(first ? { period: first.period, game_time: first.game_time, score_after: first.score_after, side: first.side } : {}),
    };
  });
  if (errors.length) return { ok: false, error: "evidence check failed", details: errors.slice(0, 20) };

  const heroId = body?.hero_media_id && mediaById.has(String(body.hero_media_id)) ? String(body.hero_media_id) : null;
  const hero: any = heroId ? mediaById.get(heroId) : null;
  const heroAt = body?.hero_at_s != null ? Math.max(1, Math.round(Number(body.hero_at_s))) : null;
  const heroUrl = hero?.kind === "image" ? (hero.public ? hero.image_url : null)
    : hero?.frame_url_template && heroAt != null ? hero.frame_url_template.replace("{SECOND}", String(heroAt)) : null;
  const text = timeline.map((t: any) => t.text).join("\n\n");
  const allVerified = timeline.every((t: any) => t.verified);

  const { data: existing } = await admin.from("game_stories").select("status,version").eq("game_id", gameId).maybeSingle();
  const mode = b.publish_mode;
  const publishNow = mode === "auto" || (mode === "verified" && allVerified);
  if (body?.dry_run) return { ok: true, dry_run: true, would: { beats: timeline.length, verified: timeline.filter((t: any) => t.verified).length, publish: publishNow, mode } };

  const content = { title, summary, body: text, timeline, moments: [], hero_image_url: heroUrl, hero_media_id: heroId,
    media_post_ids: [], facts_hash: b.facts_hash, generated_at: new Date().toISOString(), generated_by: String(body?.generated_by ?? "routine").slice(0, 60) };

  if (existing?.status === "published" && !publishNow) {
    // Live story stays as is; the newer version waits for an editor.
    const { error } = await admin.from("game_stories").update({ pending_revision: content }).eq("game_id", gameId);
    if (error) throw error;
    return { ok: true, saved: "pending_revision", beats: timeline.length, verified: timeline.filter((t: any) => t.verified).length, mode };
  }
  const row = { game_id: gameId, ...content, status: publishNow ? "published" : "draft", auto_published: publishNow,
    pending_revision: null, version: (existing?.version ?? 0) + 1,
    ...(publishNow ? { published_at: new Date().toISOString() } : { published_at: null, published_by: null }) };
  const { error } = await admin.from("game_stories").upsert(row, { onConflict: "game_id" });
  if (error) throw error;
  return { ok: true, saved: publishNow ? "published" : "draft", beats: timeline.length, verified: timeline.filter((t: any) => t.verified).length, mode,
    review_url: `${SITE}/creators?tab=stories` };
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
