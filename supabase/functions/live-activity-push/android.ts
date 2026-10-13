// ============================================================================
// live-activity-push / android.ts — the Android half of the live-game fan-out.
//
// Android has no ActivityKit: the app builds one ongoing "Live Update" notification itself
// from an FCM DATA-ONLY message (so it works with the app killed). The rows are the same
// live_activity_tokens / live_activity_start_tokens with platform = 'android' and the
// device's FCM registration token. index.ts routes those rows here from sendLA().
//
// Wire contract (shared field names with the iOS ContentState):
//   MOBILE-BUILD/status-bar-preview/LIVE-PAYLOAD.md
// Client: HockeyLeague-Android statusbar/LivePayload.kt (LiveUpdate.parse).
//
// FCM HTTP v1 with the SAME service account as send-push (FCM_PROJECT_ID /
// FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY). send-push itself is not touched: the token minting
// is a copy of its code. No Firebase secrets → Android rows are skipped (status 0).
// ============================================================================

export const APPLE_EPOCH_S = 978307200;

const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID") ?? "";
const FCM_CLIENT_EMAIL = Deno.env.get("FCM_CLIENT_EMAIL") ?? "";
const FCM_PRIVATE_KEY = (Deno.env.get("FCM_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
export const FCM_CONFIGURED = !!(FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY);

// ---- Per-pass context ------------------------------------------------------
export type TeamRow = { id: string; name: string; primary_color?: string | null; secondary_color?: string | null; logo_url?: string | null };
export type RawEvent = { id?: string; type?: string; side?: string; player?: string | null; timeMS?: number | null; period?: string; ownGoal?: boolean };
/** What index.ts already loaded for the pass, plus the two team rows (with logo_url). */
export type AndroidCtx = {
  game: { id: string; status?: string; game_date: string; venue?: string | null; home_team_id: string; away_team_id: string };
  live: { phase?: string | null; period?: string | null; state?: { periodMS?: number } | null } | null;
  events: RawEvent[];
  home: TeamRow;
  away: TeamRow;
};

/** Loads the team rows (logo_url, colours) the Android payload needs. One query per pass. */
// deno-lint-ignore no-explicit-any
export async function androidCtx(admin: any, d: any): Promise<AndroidCtx> {
  const { data: teams } = await admin.from("teams")
    .select("id,name,primary_color,secondary_color,logo_url")
    .in("id", [d.game.home_team_id, d.game.away_team_id]);
  const find = (id: string, fallback: string): TeamRow =>
    (teams ?? []).find((t: TeamRow) => t.id === id) ?? { id, name: fallback };
  return {
    game: d.game, live: d.live ?? null, events: d.events ?? [],
    home: find(d.game.home_team_id, "בית"), away: find(d.game.away_team_id, "חוץ"),
  };
}

// ---- Team colour: the app's TeamBannerColors.solid (keep in step) -----------
// Too light for white text (WCAG L > 0.30) → mixed 55% toward #0F172A per 8-bit channel.
export function readableHex(hex?: string | null): string | null {
  const m = (hex ?? "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  const v = parseInt(m, 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(ch[0]) + 0.7152 * lin(ch[1]) + 0.0722 * lin(ch[2]);
  const deep = [0x0f, 0x17, 0x2a];
  const out = L <= 0.30 ? ch : ch.map((c, i) => Math.min(255, Math.max(0, Math.round(c + (deep[i] - c) * 0.55))));
  return "#" + out.map((c) => c.toString(16).padStart(2, "0")).join("");
}

export const shortName = (n: string) => {
  const clean = n.replace(/\p{Extended_Pictographic}/gu, "").trim();
  return clean.length <= 9 ? clean : clean.split(/\s+/)[0];
};

const periodIdx = (p?: string | null): number => {
  const s = (p ?? "").trim();
  if (s === "2") return 1;
  if (s === "3" || s.startsWith("הארכה") || s.includes("פנדל")) return 2;
  return 0;
};

/** Goals as "h:<game second>,a:<…>" for the progress-bar dots (max 20, chronological). */
export function goalsString(events: RawEvent[], periodMS: number): string {
  const perS = Math.round(periodMS / 1000);
  return events
    .filter((e) => e.type === "goal" && (e.side === "home" || e.side === "away"))
    .map((e) => {
      const into = e.timeMS == null ? 0 : Math.max(0, Math.round((periodMS - Number(e.timeMS)) / 1000));
      return `${e.side === "home" ? "h" : "a"}:${periodIdx(e.period) * perS + Math.min(into, perS)}`;
    })
    .slice(-20)
    .join(",");
}

const appleToMs = (s?: number | null) => (s == null ? null : Math.round((Number(s) + APPLE_EPOCH_S) * 1000));

/**
 * The FCM data map (all strings) for one APNs-shaped body this pass built. `aps.event`:
 * update / start → the content-state; end → "final" (full time) or "ended" (abandoned:
 * dismissal-date ≤ timestamp, the game went back to scheduled).
 */
// deno-lint-ignore no-explicit-any
export function androidData(ctx: AndroidCtx, body: any, now = Date.now()): Record<string, string> {
  const aps = body?.aps ?? {};
  // deno-lint-ignore no-explicit-any
  const cs: any = aps["content-state"] ?? {};
  const periodMS = Number(ctx.live?.state?.periodMS) > 0 ? Number(ctx.live!.state!.periodMS) : 25 * 60_000;
  const label = String(ctx.live?.period ?? "");
  const isTimeout = ctx.live?.phase === "breakTime" && label.startsWith("פסק זמן");
  const abandoned = aps.event === "end" && cs.phase !== "final";
  const status = aps.event === "end"
    ? (abandoned ? "ended" : "final")
    : isTimeout ? "timeout" : String(cs.phase ?? "live");

  const endsMs = appleToMs(cs.clockEndsAt);
  const running = endsMs != null;
  const remaining = running ? Math.max(0, endsMs! - now) : Math.max(0, Math.round(Number(cs.clockRemaining ?? 0) * 1000));

  const out: Record<string, string> = {
    type: "live_game", v: "1", gameId: ctx.game.id,
    // Monotonic per game: the pass that claimed the newer state sends later.
    seq: String(now), sentAt: String(now),
    status, period: String(cs.period ?? "first"),
    homeScore: String(cs.homeScore ?? 0), awayScore: String(cs.awayScore ?? 0),
    clockRemainingMs: String(remaining), clockRunning: running ? "1" : "0",
    periodMs: String(periodMS),
    highlight: cs.highlight ? "1" : "0",
    homeFouls: String(cs.homeFouls ?? 0), awayFouls: String(cs.awayFouls ?? 0),
    homeId: ctx.home.id, awayId: ctx.away.id,
    homeName: ctx.home.name, awayName: ctx.away.name,
    homeShort: shortName(ctx.home.name), awayShort: shortName(ctx.away.name),
    homeColor: readableHex(ctx.home.primary_color) ?? "#3b4fc4",
    awayColor: readableHex(ctx.away.primary_color) ?? "#3b4fc4",
    kickoff: String(Date.parse(ctx.game.game_date) || 0),
  };
  if (running) out.clockEndsAt = String(endsMs);
  if (label && (isTimeout || cs.phase === "halftime")) out.periodLabel = label;
  if (ctx.home.logo_url) out.homeLogo = ctx.home.logo_url;
  if (ctx.away.logo_url) out.awayLogo = ctx.away.logo_url;
  if (ctx.game.venue) out.venue = ctx.game.venue;
  const ev = cs.lastEvent;
  if (ev?.kind) {
    out.lastEventKind = String(ev.kind);
    if (ev.side) out.lastEventSide = String(ev.side);
    if (ev.player) out.lastEventPlayer = String(ev.player);
    if (ev.minute != null) out.lastEventMinute = String(ev.minute);
  }
  const sus = cs.suspension;
  if (sus && status === "live") {
    const susEnds = appleToMs(sus.endsAt);
    if (susEnds != null && susEnds > now) {
      out.suspSide = String(sus.side);
      if (sus.player) out.suspPlayer = String(sus.player);
      out.suspRed = sus.isRed ? "1" : "0";
      out.suspRemainingMs = String(susEnds - now);
      if (running) out.suspEndsAt = String(susEnds);
    }
  }
  const goals = goalsString(ctx.events, periodMS);
  if (goals) out.goals = goals;
  return out;
}

// ---- FCM HTTP v1 (copied from send-push, which stays untouched) -----------
const b64urlBytes = (bytes: Uint8Array) => {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (s: string) => b64urlBytes(new TextEncoder().encode(s));
function pemToPkcs8(pem: string): ArrayBuffer {
  const raw = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
let keyP: Promise<CryptoKey> | null = null;
let access: { token: string; exp: number } | null = null;
async function fcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (access && now < access.exp - 300) return access.token;
  keyP ??= crypto.subtle.importKey("pkcs8", pemToPkcs8(FCM_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const input = `${b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlStr(JSON.stringify({
    iss: FCM_CLIENT_EMAIL, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))}`;
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, await keyP, new TextEncoder().encode(input));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${b64urlBytes(new Uint8Array(sig))}` }),
  });
  if (!res.ok) throw new Error(`FCM token ${res.status} ${await res.text()}`);
  const j = await res.json();
  access = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return access.token;
}

/** The FCM v1 message: data-only, HIGH for priority-10 changes, collapsed per game. */
export function fcmMessage(token: string, data: Record<string, string>, priority: 5 | 10) {
  const important = priority === 10 || data.status === "final" || data.status === "ended";
  return {
    message: {
      token,
      data,
      android: { priority: important ? "HIGH" : "NORMAL", ttl: "600s", collapse_key: `live_${data.gameId}` },
    },
  };
}

export type SendResult = { id: string; status: number; reason?: string; prune: boolean };

export async function sendAndroid(
  row: { id: string; token: string },
  data: Record<string, string>,
  priority: 5 | 10,
): Promise<SendResult> {
  if (!FCM_CONFIGURED) return { id: row.id, status: 0, reason: "fcm not configured", prune: false };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await fcmAccessToken()}`, "content-type": "application/json" },
    body: JSON.stringify(fcmMessage(row.token, data, priority)),
  });
  if (res.ok) return { id: row.id, status: res.status, prune: false };
  const reason = await res.text();
  // Same rule as send-push: uninstalled / rotated (404 UNREGISTERED) or a token minted
  // for another Firebase project → delete the row.
  const prune = res.status === 404 || reason.includes("UNREGISTERED") || reason.includes("SENDER_ID_MISMATCH");
  return { id: row.id, status: res.status, reason: reason.slice(0, 300), prune };
}
