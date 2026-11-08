// ============================================================================
// weather-watch — rain decision engine for upcoming games.
//
// Called hourly by pg_cron (public.run_weather_watch) with the service key.
// For each scheduled, non-test game kicking off in the next HORIZON_H hours:
//   1. read the Open-Meteo hourly forecast at the venue's pin (UTC hours);
//   2. decide  ok / watch / move  from rain before kick-off (wet floor) and
//      rain / thunder / gusts during the game  (decide() below — the rules);
//   3. when it's "move", look for an alternative venue that is dry AND has no
//      other game within ±2 h, nearest first;
//   4. upsert game_weather_checks; push admins + league managers (an
//      `announcement` notification → send-push, so every app build shows it)
//      when a game turns "move", or when a "move" alert is called off.
//
// Body (all optional): { dry: true } → decide only, no writes, no pushes;
// { horizon_hours: n } → look further ahead (testing); { game_id } → one game.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SB_SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const HORIZON_H = 72;            // forecasts past 3 days are too soft to move a game on
const BEFORE_H = 3;              // rain in the 3 h before kick-off leaves the floor wet
const GAME_H = 2;                // kick-off hour + 2 → covers a full game
const CLASH_H = 2;               // an alternative venue must be free ±2 h around kick-off
const ALL_CLEAR_MIN_LEAD_H = 2;  // don't send "called off" in the last 2 h — too late to matter

type Hour = { t: number; rainProb: number; rainMm: number; code: number; gust: number };
type Verdict = { level: "ok" | "watch" | "move"; reasons: string[]; metrics: Record<string, number> };

// ---------------------------------------------------------------- forecast
const fcCache = new Map<string, Promise<Hour[] | null>>();
function forecast(lat: number, lng: number): Promise<Hour[] | null> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (!fcCache.has(key)) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + `&hourly=precipitation_probability,precipitation,weather_code,wind_gusts_10m`
      + `&timezone=UTC&past_days=1&forecast_days=16&wind_speed_unit=kmh`;
    fcCache.set(key, fetch(url).then(async (r) => {
      if (!r.ok) return null;
      const h = (await r.json())?.hourly;
      if (!h?.time?.length) return null;
      return h.time.map((t: string, i: number) => ({
        t: Date.parse(t + ":00Z"),
        rainProb: h.precipitation_probability[i] ?? 0,
        rainMm: h.precipitation[i] ?? 0,
        code: h.weather_code[i] ?? 0,
        gust: h.wind_gusts_10m[i] ?? 0,
      }));
    }).catch(() => null));
  }
  return fcCache.get(key)!;
}

// ---------------------------------------------------------------- the rules
/**
 * Rink hockey is played on an outdoor tiled floor: even light rain makes it
 * slippery and unsafe, and it doesn't dry in minutes. So:
 *  MOVE  — during the game: an hour with ≥60% chance AND ≥0.5 mm, or ≥1 mm total
 *          with ≥50% chance, or a thunderstorm, or gusts ≥50 km/h;
 *          before kick-off: ≥2 mm in the 3 hours before (floor won't dry).
 *  WATCH — during: max chance ≥35% or any hour ≥0.2 mm; before: ≥0.5 mm.
 *  OK    — otherwise.
 */
function decide(hours: Hour[], kickoff: number): Verdict | null {
  const k = Math.floor(kickoff / 3600_000) * 3600_000;
  const before = hours.filter((h) => h.t >= k - BEFORE_H * 3600_000 && h.t < k);
  const during = hours.filter((h) => h.t >= k && h.t <= k + GAME_H * 3600_000);
  if (!during.length) return null;

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const m = {
    max_prob: Math.max(...during.map((h) => h.rainProb)),
    rain_mm: r1(during.reduce((s, h) => s + h.rainMm, 0)),
    before_mm: r1(before.reduce((s, h) => s + h.rainMm, 0)),
    max_gust: Math.round(Math.max(...during.map((h) => h.gust))),
    thunder: during.some((h) => h.code >= 95) ? 1 : 0,
  };

  const move: string[] = [];
  if (during.some((h) => h.rainProb >= 60 && h.rainMm >= 0.5)) move.push("גשם צפוי בזמן המשחק");
  else if (m.rain_mm >= 1 && m.max_prob >= 50) move.push(`${m.rain_mm} מ״מ גשם בזמן המשחק`);
  if (m.thunder) move.push("סופת רעמים");
  if (m.max_gust >= 50) move.push(`משבי רוח עד ${m.max_gust} קמ״ש`);
  if (m.before_mm >= 2) move.push(`${m.before_mm} מ״מ גשם בשעות שלפני — המגרש לא יספיק להתייבש`);
  if (move.length) return { level: "move", reasons: move, metrics: m };

  const watch: string[] = [];
  if (m.max_prob >= 35) watch.push(`${m.max_prob}% סיכוי לגשם`);
  if (during.some((h) => h.rainMm >= 0.2)) watch.push("טפטוף אפשרי");
  if (m.before_mm >= 0.5) watch.push("גשם קל לפני המשחק");
  if (watch.length) return { level: "watch", reasons: watch, metrics: m };
  return { level: "ok", reasons: [], metrics: m };
}

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLng = (b.lng - a.lng) * d2r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
};

const ilTime = (iso: string) => new Date(iso).toLocaleString("he-IL", {
  timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
});

// ---------------------------------------------------------------- run
Deno.serve(async (req) => {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== SB_SERVICE_ROLE) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const dry = body?.dry === true;
  const horizonH = Number(body?.horizon_hours) > 0 ? Math.min(Number(body.horizon_hours), 16 * 24) : HORIZON_H;

  const now = Date.now();
  let gq = db.from("games")
    .select("id, game_date, venue, status, home_team_id, away_team_id, is_test")
    .eq("status", "scheduled")
    .gt("game_date", new Date(now).toISOString())
    .lte("game_date", new Date(now + horizonH * 3600_000).toISOString());
  if (body?.game_id) gq = gq.eq("id", body.game_id);
  const { data: games, error: gErr } = await gq;
  if (gErr) return Response.json({ ok: false, error: gErr.message }, { status: 500 });
  const live = (games ?? []).filter((g) => !g.is_test);
  if (!live.length) return Response.json({ ok: true, checked: 0, results: [] });

  const [{ data: venues }, { data: teams }, { data: prior }] = await Promise.all([
    db.from("venues").select("name, lat, lng").eq("is_active", true),
    db.from("teams").select("id, name"),
    db.from("game_weather_checks").select("game_id, notified_level").in("game_id", live.map((g) => g.id)),
  ]);
  const pinned = (venues ?? []).filter((v) => v.lat != null && v.lng != null);
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const notified = new Map((prior ?? []).map((p) => [p.game_id, p.notified_level as string | null]));

  // Other games near each kick-off, to rule out busy alternative venues.
  const minT = Math.min(...live.map((g) => Date.parse(g.game_date))) - CLASH_H * 3600_000;
  const maxT = Math.max(...live.map((g) => Date.parse(g.game_date))) + CLASH_H * 3600_000;
  const { data: nearby } = await db.from("games").select("id, game_date, venue")
    .in("status", ["scheduled", "in_progress"])
    .gte("game_date", new Date(minT).toISOString()).lte("game_date", new Date(maxT).toISOString());

  let recipients: string[] | null = null;
  const results: unknown[] = [];

  for (const g of live) {
    const kick = Date.parse(g.game_date);
    const venue = pinned.find((v) => v.name?.trim() === g.venue?.trim());
    if (!venue) { results.push({ game_id: g.id, skipped: "venue has no pin" }); continue; }
    let hours = await forecast(Number(venue.lat), Number(venue.lng));
    // Test hook: dry runs only — pour 3 mm/h at 90% on this venue so the "move" path,
    // the alternatives search and the push copy can be checked on a sunny day.
    if (dry && body?.simulate_rain && hours) hours = hours.map((h) => ({ ...h, rainProb: 90, rainMm: 3, code: 63 }));
    const v = hours && decide(hours, kick);
    if (!v) { results.push({ game_id: g.id, skipped: "no forecast" }); continue; }

    // Alternatives: dry (ok) + free, nearest first.
    let alternatives: { venue: string; km: number }[] = [];
    if (v.level === "move") {
      for (const alt of pinned) {
        if (alt.name?.trim() === g.venue?.trim()) continue;
        const busy = (nearby ?? []).some((o) => o.id !== g.id && o.venue?.trim() === alt.name?.trim()
          && Math.abs(Date.parse(o.game_date) - kick) < CLASH_H * 3600_000);
        if (busy) continue;
        const ah = await forecast(Number(alt.lat), Number(alt.lng));
        const av = ah && decide(ah, kick);
        if (av?.level === "ok") alternatives.push({ venue: alt.name.trim(), km: km(venue as any, alt as any) });
      }
      alternatives = alternatives.sort((a, b) => a.km - b.km).slice(0, 2);
    }

    const prev = notified.get(g.id) ?? null;
    const leadH = (kick - now) / 3600_000;
    const action = v.level === "move" && prev !== "move" ? "alert_move"
      : prev === "move" && v.level !== "move" && leadH >= ALL_CLEAR_MIN_LEAD_H ? "all_clear"
      : null;

    const home = teamName.get(g.home_team_id) ?? "", away = teamName.get(g.away_team_id) ?? "";
    const when = ilTime(g.game_date);
    let push: { title: string; body: string } | null = null;
    if (action === "alert_move") {
      const alt = alternatives.length
        ? `מגרש חלופי יבש ופנוי: ${alternatives.map((a) => `${a.venue} (${a.km} ק״מ)`).join(" / ")}. אחרת — לשקול דחייה.`
        : "אין מגרש חלופי יבש ופנוי באותה שעה — לשקול דחייה.";
      push = {
        title: `⛈️ גשם: כדאי להעביר את ${home} נגד ${away}`,
        body: `${when} · ${g.venue}. ${v.reasons.join(", ")} (${v.metrics.max_prob}% סיכוי). ${alt}`,
      };
    } else if (action === "all_clear") {
      push = {
        title: `☀️ התחזית השתפרה: ${home} נגד ${away}`,
        body: `${when} · ${g.venue}. כבר לא צפוי גשם שמצדיק העברה — המשחק יכול להתקיים כמתוכנן.`,
      };
    }

    if (!dry) {
      const row: Record<string, unknown> = {
        game_id: g.id, level: v.level, reasons: v.reasons, kickoff: g.game_date, venue: g.venue,
        details: { metrics: v.metrics, alternatives }, checked_at: new Date().toISOString(),
      };
      if (push) {
        if (!recipients) {
          const { data: rs } = await db.rpc("weather_alert_recipients");
          recipients = (rs ?? []).map((r: { user_id: string }) => r.user_id);
        }
        const rows = recipients.map((uid) => ({
          user_id: uid, type: "announcement", entity_type: "game", entity_id: g.id,
          data: { title: push!.title, body: push!.body, href: `/games/${g.id}`, kind: "weather_alert", level: v.level },
        }));
        if (rows.length) {
          const { error } = await db.from("notifications").insert(rows);
          if (error) { results.push({ game_id: g.id, error: error.message }); continue; }
        }
        row.notified_level = v.level;
        row.notified_at = new Date().toISOString();
      }
      await db.from("game_weather_checks").upsert(row, { onConflict: "game_id" });
    }

    results.push({ game_id: g.id, match: `${home} - ${away}`, when, venue: g.venue, ...v, alternatives, action, push });
  }

  return Response.json({ ok: true, dry, checked: live.length, results });
});
