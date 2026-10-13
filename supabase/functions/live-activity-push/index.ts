// ============================================================================
// live-activity-push — the live game on iPhone Lock Screens / Dynamic Islands.
//
// Called by AFTER triggers (supabase/live-activity.sql) through pg_net, never by end
// users. Auth = the shared secret in `x-push-secret` (PUSH_WEBHOOK_SECRET, the same one
// send-push uses) → verify_jwt is off for this function.
//
// Body: { game_id, op, token_id?, dry_run? }
//   op = "state"     a judge broadcast changed live_game_state
//        "deleted"   the live row went away (save / abandon / expiry)
//        "completed" games.status → completed
//        "register"  a device just registered an activity token (send it the current
//                    state, to that token only)
//        "deferred"  internal: a coalesced low-priority push whose 10 s window passed
//        "start_probe" QA: push-to-start the one start token `token_id` for this game
//
// What it does: maps games + live_game_state (+ the full play-by-play in game_reports)
// to the app's ActivityKit ContentState (`GameState` in the iOS app,
// Sources/Shared/LiveActivity/GameActivityAttributes.swift), dedupes against what it
// last pushed for the game, and sends APNs `liveactivity` pushes:
//   • priority 10 + alert: goal, red card, period / phase change, full time;
//   • priority 5, at most one per ~10 s per game (coalesced): clock start/stop, fouls,
//     blue cards, timeouts — rink hockey is stop-time, a push per whistle would burn the
//     Live Activity budget, and the clock ticks on the device without pushes anyway;
//   • `event: end` at full time with a 30-minute dismissal date, then the tokens go;
//   • push-to-start (iOS 17.2+): the first time the clock runs, every follower of either
//     team who has a start token and no activity for the game yet gets one.
// Dead tokens (410 / Unregistered / BadDeviceToken) are deleted, like send-push does.
//
// Dates in content-state / attributes are seconds since 2001-01-01 (Swift's default
// `Date` Codable form, which ActivityKit decodes with), NOT Unix seconds.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type AndroidCtx, androidCtx, androidData, sendAndroid } from "./android.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET")!;
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID")!;
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID")!;
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "com.arielbiton.rinkhockeyil";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY")!;
const LA_TOPIC = `${APNS_BUNDLE_ID}.push-type.liveactivity`;

const APPLE_EPOCH_S = 978307200;            // 2001-01-01T00:00:00Z in Unix seconds
const P5_GAP_MS = 10_000;                    // low-priority coalescing window
const BLUE_MS = 120_000, RED_MS = 240_000;   // GameRules.blueCardSeconds / redCardSeconds
const DISMISS_AFTER_S = 30 * 60;             // the final card stays 30 min

const admin = createClient(SB_URL, SB_SERVICE_ROLE, { auth: { persistSession: false } });

// ---- small helpers ---------------------------------------------------------
const appleDate = (ms: number) => Math.round((ms / 1000 - APPLE_EPOCH_S) * 1000) / 1000;
const nowS = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

// ---- Team colours: a port of the app's TeamColors.tintHex ------------------
// (contrast-conditioned for white text; the Live Activity draws crests in these rings)
type HSL = { h: number; s: number; l: number };
function hexToHsl(hex?: string | null): HSL | null {
  const m = (hex ?? "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  const v = parseInt(m, 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l };
}
function hslRgb({ h, s, l }: HSL): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0]; else if (h < 120) rgb = [x, c, 0]; else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c]; else if (h < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}
const chromatic = (c: HSL) => { const [r, g, b] = hslRgb(c); return c.s >= 0.12 && Math.max(r, g, b) - Math.min(r, g, b) >= 0.08; };
const lum = (c: HSL) => {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = hslRgb(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const toHex = (c: HSL) => "#" + hslRgb(c).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
const nearBlack = (hue: number | null): HSL => ({ h: hue ?? 218, s: hue == null ? 0.18 : 0.35, l: 0.11 });
function slate(c: HSL): HSL {
  const out = { h: 218, s: 0.16, l: 0.30 + 0.12 * (c.l - 0.5) / 0.5 };
  while (lum(out) > 0.2125 && out.l > 0.12) out.l -= 0.01;
  return out;
}
function conditioned(c: HSL, partnerHue: number | null): HSL {
  if (!chromatic(c)) return c.l < 0.3 ? nearBlack(partnerHue) : slate(c);
  const out = { h: c.h, s: Math.min(c.s, 0.88), l: Math.min(c.l, 0.55) };
  while (lum(out) > 0.2125 && out.l > 0.12) out.l -= 0.01;
  out.l = Math.max(out.l, 0.18);
  return out;
}
export function tintHex(primary?: string | null, secondary?: string | null): string {
  const p = hexToHsl(primary), s = hexToHsl(secondary);
  if (p) return toHex(conditioned(p, s && chromatic(s) ? s.h : null));
  if (s) return toHex(conditioned(s, null));
  return "#3B4FC4"; // brand blue; the app falls back to a hashed colour the same way
}

// ---- The ContentState (mirror of the Swift `GameState`) ---------------------
type Side = "home" | "away";
type LAEvent = { kind: string; side?: Side; player?: string; minute?: number };
type Suspension = { side: Side; player: string; isRed: boolean; startedAt: number; endsAt: number };
type GameState = {
  phase: "pregame" | "live" | "halftime" | "final";
  period: "first" | "second" | "third" | "overtime" | "penalties";
  homeScore: number; awayScore: number;
  clockEndsAt?: number; clockRemaining: number;
  lastEvent?: LAEvent; highlight: boolean;
  homeFouls: number; awayFouls: number;
  suspension?: Suspension; attending: boolean;
};
type RawEvent = { id?: string; type?: string; side?: string; player?: string | null; timeMS?: number | null; period?: string; ownGoal?: boolean };

const PERIOD_LABEL: Record<GameState["period"], string> = {
  first: "מחצית 1", second: "מחצית 2", third: "תקופה 3", overtime: "הארכה", penalties: "פנדלים",
};
function parsePeriod(p?: string | null): GameState["period"] | null {
  const s = (p ?? "").trim();
  if (s === "1") return "first";
  if (s === "2") return "second";
  if (s === "3") return "third";
  if (s.startsWith("הארכה")) return "overtime";
  if (s.includes("פנדל")) return "penalties";
  return null;
}
const periodIndex = (p?: string) => ({ first: 0, second: 1, third: 2, overtime: 2, penalties: 3 } as const)[parsePeriod(p) ?? "first"];

function mergeEvents(archived: RawEvent[] | null, window: RawEvent[] | null): RawEvent[] {
  const a = Array.isArray(archived) ? archived : [];
  const w = Array.isArray(window) ? window : [];
  if (!a.length) return w;
  const seen = new Set(a.map((e) => e.id));
  return [...a, ...w.filter((e) => !seen.has(e.id))];
}

function buildState(game: any, live: any | null, events: RawEvent[], prev: GameState | null): GameState {
  const now = Date.now();
  const periodMS = Number(live?.state?.periodMS) > 0 ? Number(live.state.periodMS) : 25 * 60_000;
  const last = events.length ? events[events.length - 1] : null;
  const final = game.status === "completed" || live?.phase === "over";
  const label = String(live?.period ?? "");
  const isBreak = live?.phase === "breakTime";
  const isTimeout = isBreak && label.startsWith("פסק זמן");
  const isHalftime = isBreak && !isTimeout && parsePeriod(label) == null;

  const period = parsePeriod(label) ?? parsePeriod(last?.period) ?? prev?.period ?? "first";
  const phase: GameState["phase"] = final ? "final" : isHalftime ? "halftime" : live ? "live" : "pregame";

  const homeScore = live ? Number(live.home_score ?? 0) : Number(game.home_score ?? 0);
  const awayScore = live ? Number(live.away_score ?? 0) : Number(game.away_score ?? 0);

  // The period clock. Running → an absolute deadline the device ticks against.
  const endsMs = live?.clock_ends_at ? Date.parse(live.clock_ends_at) : NaN;
  const running = phase === "live" && live?.phase === "running" && !!live?.is_running && Number.isFinite(endsMs);
  let remainingMs: number;
  if (running) remainingMs = Math.max(0, endsMs - now);
  else if (isHalftime || final) remainingMs = 0;
  else if (isTimeout) {
    const to = [...events].reverse().find((e) => e.type === "timeout");
    remainingMs = Number(to?.timeMS ?? live?.clock_remaining_ms ?? 0);
  } else if (live) remainingMs = Number(live.clock_remaining_ms ?? periodMS);
  else remainingMs = periodMS;

  const s: GameState = {
    phase, period, homeScore, awayScore,
    clockRemaining: Math.max(0, Math.round(remainingMs / 1000)),
    highlight: false,
    homeFouls: events.filter((e) => e.type === "foul" && e.side === "home").length,
    awayFouls: events.filter((e) => e.type === "foul" && e.side === "away").length,
    attending: false,
  };
  if (running) s.clockEndsAt = appleDate(endsMs);

  if (last) {
    const kind = ({ goal: "goal", blue: "blueCard", red: "redCard", timeout: "timeout", foul: "foul" } as Record<string, string>)[last.type ?? ""] ?? "info";
    const ev: LAEvent = { kind };
    if (last.side === "home" || last.side === "away") ev.side = last.side;
    const who = last.ownGoal ? "שער עצמי" : (last.player ?? "").trim();
    if (who) ev.player = who;
    if (Number.isFinite(Number(last.timeMS)) && last.timeMS != null) {
      const inPeriod = Math.max(1, Math.ceil((periodMS - Number(last.timeMS)) / 60_000));
      ev.minute = periodIndex(last.period) * Math.round(periodMS / 60_000) + inPeriod;
    }
    s.lastEvent = ev;
  }

  // The latest card still being served (game-clock time, so it only runs with the clock).
  if (phase === "live") {
    let best: Suspension | null = null;
    for (const e of events) {
      if ((e.type !== "blue" && e.type !== "red") || e.timeMS == null) continue;
      if (parsePeriod(e.period) !== period) continue;
      const dur = e.type === "red" ? RED_MS : BLUE_MS;
      const served = Number(e.timeMS) - remainingMs;
      if (served < 0 || served >= dur) continue;
      const endsAt = running ? endsMs - (Number(e.timeMS) - dur) : now + (dur - served);
      const sus: Suspension = {
        side: e.side === "away" ? "away" : "home", player: (e.player ?? "").trim(),
        isRed: e.type === "red", startedAt: appleDate(endsAt - dur), endsAt: appleDate(endsAt),
      };
      if (!best || sus.endsAt > best.endsAt) best = sus;
    }
    if (best) s.suspension = best;
  }
  return s;
}

/** What a viewer can see changed. Clock anchors are rounded: every broadcast re-derives
 *  the deadline a few ms apart, and a paused clock's value is irrelevant while running. */
function signature(s: GameState): string {
  const r2 = (v?: number) => (v == null ? null : Math.round(v / 2));
  return JSON.stringify({
    ...s, highlight: undefined,
    clockEndsAt: r2(s.clockEndsAt),
    clockRemaining: s.clockEndsAt != null ? null : s.clockRemaining,
    suspension: s.suspension ? { ...s.suspension, startedAt: undefined, endsAt: r2(s.suspension.endsAt) } : null,
  });
}

// ---- Copy (Hebrew; never "a:b" — digit order flips inside RTL text) --------
function scoreLine(t: any, s: GameState) {
  return `${t.homeName} ${s.homeScore} · ${t.awayName} ${s.awayScore}`;
}
type Push = { event: "update" | "end"; priority: 5 | 10; alert?: { title: string; body: string } };
function classify(s: GameState, prev: GameState | null, newEventId: string | null, prevEventId: string | null, t: any): Push {
  if (s.phase === "final") {
    const w = s.homeScore === s.awayScore ? null : s.homeScore > s.awayScore ? t.homeName : t.awayName;
    return { event: "end", priority: 10, alert: { title: w ? `סיום · ${w} ניצחה` : "סיום · תיקו", body: scoreLine(t, s) } };
  }
  if (!prev) return { event: "update", priority: 10 };
  if (s.homeScore !== prev.homeScore || s.awayScore !== prev.awayScore) {
    const side: Side = s.homeScore > prev.homeScore ? "home" : "away";
    const team = side === "home" ? t.homeName : t.awayName;
    const who = s.lastEvent?.kind === "goal" && s.lastEvent.side === side
      ? ` · ${s.lastEvent.player ?? ""}${s.lastEvent.minute ? ` ${s.lastEvent.minute}'` : ""}` : "";
    if (s.homeScore + s.awayScore > prev.homeScore + prev.awayScore) {
      return { event: "update", priority: 10, alert: { title: `גול! ${team}`, body: `${scoreLine(t, s)}${who}` } };
    }
    return { event: "update", priority: 10 }; // a goal taken back: correct it, quietly
  }
  if (s.lastEvent?.kind === "redCard" && newEventId && newEventId !== prevEventId) {
    const team = s.lastEvent.side === "away" ? t.awayName : t.homeName;
    return { event: "update", priority: 10, alert: { title: `כרטיס אדום · ${team}`, body: `${s.lastEvent.player ?? ""} · משחק בחסר`.trim() } };
  }
  if (s.phase !== prev.phase || s.period !== prev.period) {
    const title = s.phase === "halftime" ? "מחצית" : prev.phase === "pregame" ? "שריקת פתיחה" : `${PERIOD_LABEL[s.period]} יצאה לדרך`;
    return { event: "update", priority: 10, alert: { title, body: scoreLine(t, s) } };
  }
  return { event: "update", priority: 5 };
}

// ---- APNs (same .p8 key + JWT as send-push; that function is not touched) ----
function b64url(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));
function pemToPkcs8(pem: string): ArrayBuffer {
  const raw = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
let keyP: Promise<CryptoKey> | null = null;
let jwtCache: { jwt: string; at: number } | null = null;
async function apnsJwt(): Promise<string> {
  const now = nowS();
  if (jwtCache && now - jwtCache.at < 3000) return jwtCache.jwt;
  keyP ??= crypto.subtle.importKey("pkcs8", pemToPkcs8(APNS_PRIVATE_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const input = `${b64urlStr(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }))}.${b64urlStr(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await keyP, new TextEncoder().encode(input));
  jwtCache = { jwt: `${input}.${b64url(new Uint8Array(sig))}`, at: now };
  return jwtCache.jwt;
}

type TokenRow = { id: string; token: string; environment: string | null; platform: string; device_id: string };
type SendResult = { id: string; status: number; reason?: string; prune: boolean };
/** Lazily loads what an Android row needs (team logos etc.) — at most once per pass. */
type AndroidThunk = () => Promise<AndroidCtx>;
// deno-lint-ignore no-explicit-any
function androidThunk(d: any): AndroidThunk {
  let p: Promise<AndroidCtx> | null = null;
  return () => (p ??= androidCtx(admin, d));
}

async function sendLA(row: TokenRow, body: unknown, priority: 5 | 10, android?: AndroidThunk): Promise<SendResult> {
  // Android: the same rows with platform 'android' + an FCM token → a data-only FCM message
  // the app turns into its Live Update notification (android.ts, LIVE-PAYLOAD.md).
  if (row.platform === "android") {
    if (!android) return { id: row.id, status: 0, reason: "no android context", prune: false };
    return sendAndroid(row, androidData(await android(), body), priority);
  }
  if (row.platform !== "ios") return { id: row.id, status: 0, reason: "unknown platform", prune: false };
  const jwt = await apnsJwt();
  const hosts = row.environment === "sandbox" ? ["api.sandbox.push.apple.com"] : ["api.push.apple.com", "api.sandbox.push.apple.com"];
  let last: SendResult = { id: row.id, status: 0, prune: false };
  for (const host of hosts) {
    const res = await fetch(`https://${host}/3/device/${row.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`, "apns-topic": LA_TOPIC,
        "apns-push-type": "liveactivity", "apns-priority": String(priority),
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { id: row.id, status: res.status, prune: false };
    const reason = await res.text();
    if (res.status === 400 && reason.includes("BadDeviceToken") && host === "api.push.apple.com" && hosts.length > 1) continue;
    const prune = res.status === 410 || reason.includes("Unregistered") || reason.includes("BadDeviceToken")
      || reason.includes("ExpiredToken");
    last = { id: row.id, status: res.status, reason, prune };
    break;
  }
  return last;
}

// ---- Data ------------------------------------------------------------------
const shortName = (n: string) => {
  const clean = n.replace(/\p{Extended_Pictographic}/gu, "").trim();
  return clean.length <= 8 ? clean : clean.split(/\s+/)[0];
};
/** Crests bundled in the widget extension: crest_000N for the 7 founding teams. */
const crestAsset = (teamId: string) => {
  const m = /^a1b2c3d4-000([1-7])-/.exec(teamId);
  return m ? `crest_000${m[1]}` : undefined;
};

async function loadAll(gameId: string) {
  const { data: game } = await admin.from("games")
    .select("id,status,game_date,venue,game_type,home_team_id,away_team_id,home_score,away_score,is_test")
    .eq("id", gameId).maybeSingle();
  if (!game) return null;
  const [{ data: teams }, { data: live }, { data: report }, { data: book }] = await Promise.all([
    admin.from("teams").select("id,name,primary_color,secondary_color").in("id", [game.home_team_id, game.away_team_id]),
    admin.from("live_game_state").select("*").eq("game_id", gameId).maybeSingle(),
    admin.from("game_reports").select("events").eq("game_id", gameId).maybeSingle(),
    admin.from("live_activity_games").select("*").eq("game_id", gameId).maybeSingle(),
  ]);
  const home: any = teams?.find((t: any) => t.id === game.home_team_id) ?? { name: "בית" };
  const away: any = teams?.find((t: any) => t.id === game.away_team_id) ?? { name: "חוץ" };
  const t = { homeName: home.name, awayName: away.name };
  const events = mergeEvents(report?.events ?? null, live?.state?.events ?? null);
  const attributes = {
    gameId: game.id, homeName: home.name, awayName: away.name,
    homeShort: shortName(home.name), awayShort: shortName(away.name),
    ...(crestAsset(game.home_team_id) ? { homeCrest: crestAsset(game.home_team_id) } : {}),
    ...(crestAsset(game.away_team_id) ? { awayCrest: crestAsset(game.away_team_id) } : {}),
    homeTintHex: tintHex(home.primary_color, home.secondary_color),
    awayTintHex: tintHex(away.primary_color, away.secondary_color),
    venue: game.venue ?? "", competition: game.game_type || "ליגה",
    kickoff: appleDate(Date.parse(game.game_date)),
  };
  return { game, live, events, book, t, attributes };
}

function apsBody(kind: "update" | "end" | "start", state: GameState, alert?: { title: string; body: string }, attributes?: unknown) {
  const ts = nowS();
  const aps: Record<string, unknown> = {
    timestamp: ts, event: kind, "content-state": state,
    "stale-date": ts + 3600, "relevance-score": 100,
  };
  if (alert) aps.alert = { title: alert.title, body: alert.body, sound: "default" };
  if (kind === "end") aps["dismissal-date"] = ts + DISMISS_AFTER_S;
  if (kind === "start") { aps["attributes-type"] = "GameActivityAttributes"; aps.attributes = attributes; }
  return { aps };
}

async function deliver(gameId: string, rows: TokenRow[], body: unknown, priority: 5 | 10, dry: boolean, android?: AndroidThunk) {
  if (dry) return [];
  const results = await Promise.all(rows.map((r) => sendLA(r, body, priority, android).catch((e) => ({ id: r.id, status: -1, reason: String(e?.message ?? e), prune: false }))));
  const dead = results.filter((r) => r.prune).map((r) => r.id);
  if (dead.length) await admin.from("live_activity_tokens").delete().in("id", dead);
  await admin.from("live_activity_games").update({ last_payload: body, last_result: results, updated_at: new Date().toISOString() }).eq("game_id", gameId);
  return results;
}

// ---- Push-to-start: followers of either team, once per game ----------------
async function pushToStart(gameId: string, d: any, state: GameState, dry: boolean) {
  if (!dry) {
    const { data: claimed } = await admin.from("live_activity_games")
      .update({ start_sent_at: new Date().toISOString() }).eq("game_id", gameId).is("start_sent_at", null).select("game_id");
    if (!claimed?.length) return { start: "already" };
  }
  const { data: fans } = await admin.from("follows").select("user_id")
    .eq("target_type", "team").eq("notify", true).in("target_id", [d.game.home_team_id, d.game.away_team_id]);
  const users = [...new Set((fans ?? []).map((f: any) => f.user_id))];
  if (!users.length) return { start: 0 };
  const [{ data: starts }, { data: running }] = await Promise.all([
    admin.from("live_activity_start_tokens").select("id,token,environment,platform,device_id").in("user_id", users),
    admin.from("live_activity_tokens").select("device_id").eq("game_id", gameId),
  ]);
  const have = new Set((running ?? []).map((r: any) => r.device_id));
  const rows = (starts ?? []).filter((r: any) => !have.has(r.device_id)) as TokenRow[];
  const body = apsBody("start", state, { title: `${d.t.homeName} נגד ${d.t.awayName}`, body: "המשחק התחיל — עקבו בזמן אמת" }, d.attributes);
  if (dry) return { start: rows.length, body };
  const android = androidThunk(d);
  const results = await Promise.all(rows.map((r) => sendLA(r, body, 10, android).catch(() => ({ id: r.id, status: -1, prune: false }))));
  const dead = results.filter((r) => r.prune).map((r) => r.id);
  if (dead.length) await admin.from("live_activity_start_tokens").delete().in("id", dead);
  return { start: rows.length, results };
}

// ---- One pass --------------------------------------------------------------
async function runPass(gameId: string, op: string, tokenId: string | null, dry: boolean): Promise<Record<string, unknown>> {
  await admin.from("live_activity_games").upsert({ game_id: gameId }, { onConflict: "game_id", ignoreDuplicates: true });
  if (op === "deferred") await admin.from("live_activity_games").update({ p5_pending_until: null }).eq("game_id", gameId);

  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await loadAll(gameId);
    if (!d) return { skipped: "no game" };
    const android = androidThunk(d);
    const prev: GameState | null = d.book?.last_state ?? null;
    let state = buildState(d.game, d.live, d.events, prev);
    const newestId = d.events.length ? String(d.events[d.events.length - 1].id ?? "") : null;

    // Abandoned / expired: the live row is gone and the game did not finish → close it now.
    if ((op === "deleted") && d.game.status !== "completed") {
      const { data: rows } = await admin.from("live_activity_tokens").select("id,token,environment,platform,device_id").eq("game_id", gameId);
      const body = { aps: { timestamp: nowS(), event: "end", "content-state": state, "dismissal-date": nowS() } };
      const results = await deliver(gameId, (rows ?? []) as TokenRow[], body, 10, dry, android);
      if (!dry) {
        await admin.from("live_activity_tokens").delete().eq("game_id", gameId);
        // The game went back to scheduled: forget what was pushed, so a restart is a
        // fresh game (first push, kickoff alert, push-to-start) rather than a diff.
        await admin.from("live_activity_games").delete().eq("game_id", gameId);
      }
      return { ended: "abandoned", results, body };
    }

    // QA: push-to-start ONE device (a start-token row id) for this game — how a real
    // device's push-to-start is tested without following a team. Secret-gated like all ops.
    if (op === "start_probe") {
      const { data: row } = await admin.from("live_activity_start_tokens").select("id,token,environment,platform,device_id").eq("id", tokenId ?? "").maybeSingle();
      if (!row) return { skipped: "no start token" };
      const body = apsBody("start", state, { title: `${d.t.homeName} נגד ${d.t.awayName}`, body: "המשחק התחיל — עקבו בזמן אמת" }, d.attributes);
      if (dry) return { dry: true, body };
      const results = [await sendLA(row as TokenRow, body, 10, android)];
      return { probe: true, results, body };
    }

    // A device just registered: bring it up to date, to that token only.
    if (op === "register") {
      const { data: row } = await admin.from("live_activity_tokens").select("id,token,environment,platform,device_id").eq("id", tokenId ?? "").maybeSingle();
      if (!row) return { skipped: "no token" };
      const body = state.phase === "final" ? apsBody("end", state) : apsBody("update", state);
      const results = await deliver(gameId, [row as TokenRow], body, 10, dry, android);
      return { registered: true, results, body };
    }

    if (d.book?.ended_at && state.phase === "final") return { skipped: "already ended" };

    const sig = signature(state);
    let startInfo: unknown = null;
    const startEligible = state.phase === "live" && state.clockEndsAt != null && !d.book?.start_sent_at;
    if (startEligible) startInfo = await pushToStart(gameId, d, state, dry);

    if (sig === d.book?.last_sig && state.phase !== "final") return { skipped: "unchanged", start: startInfo };
    const push = classify(state, prev, newestId, d.book?.last_event_id ?? null, d.t);
    if (push.alert?.title.startsWith("גול")) state = { ...state, highlight: true };

    // Low priority: one per 10 s per game; a change inside the window waits for its end.
    if (push.priority === 5 && d.book?.last_p5_at && Date.now() - Date.parse(d.book.last_p5_at) < P5_GAP_MS) {
      const until = new Date(Date.parse(d.book.last_p5_at) + P5_GAP_MS);
      const { data: mine } = await admin.from("live_activity_games")
        .update({ p5_pending_until: until.toISOString() }).eq("game_id", gameId)
        .or(`p5_pending_until.is.null,p5_pending_until.lt.${new Date().toISOString()}`).select("game_id");
      if (mine?.length && !dry) {
        // @ts-ignore EdgeRuntime is provided by the Supabase runtime
        EdgeRuntime.waitUntil(sleep(Math.max(0, until.getTime() - Date.now()) + 50).then(() => runPass(gameId, "deferred", null, false)).catch(() => {}));
      }
      return { deferred: true, until: until.toISOString(), start: startInfo };
    }

    // Claim the change (compare-and-swap on the last signature) so two overlapping
    // invocations never both alert the same goal.
    const nowIso = new Date().toISOString();
    let claim = admin.from("live_activity_games").update({
      last_sig: sig, last_state: state, last_event_id: newestId, last_sent_at: nowIso,
      ...(push.priority === 5 ? { last_p5_at: nowIso } : {}),
      ...(push.event === "end" ? { ended_at: nowIso } : {}),
      updated_at: nowIso,
    }).eq("game_id", gameId);
    claim = d.book?.last_sig == null ? claim.is("last_sig", null) : claim.eq("last_sig", d.book.last_sig);
    if (dry) {
      return { dry: true, state, push, body: apsBody(push.event, state, push.alert), start: startInfo };
    }
    const { data: won } = await claim.select("game_id");
    if (!won?.length) continue; // someone else moved it: re-read and recompute

    const { data: rows } = await admin.from("live_activity_tokens").select("id,token,environment,platform,device_id").eq("game_id", gameId);
    const body = apsBody(push.event, state, push.alert);
    const results = await deliver(gameId, (rows ?? []) as TokenRow[], body, push.priority, false, android);
    if (push.event === "end") await admin.from("live_activity_tokens").delete().eq("game_id", gameId);
    return { sent: results.length, priority: push.priority, event: push.event, results, start: startInfo };
  }
  return { skipped: "contended" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get("x-push-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  let p: any;
  try { p = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  const gameId = String(p?.game_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) return new Response("missing game_id", { status: 400 });
  try {
    const out = await runPass(gameId, String(p.op ?? "state"), p.token_id ? String(p.token_id) : null, p.dry_run === true);
    console.log("live-activity-push", gameId, p.op, JSON.stringify(out).slice(0, 600));
    return json(out);
  } catch (e: any) {
    console.log("live-activity-push error", gameId, e?.message ?? String(e));
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
