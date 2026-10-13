// deno test --no-config --allow-env supabase/functions/live-activity-push/android.test.ts
// The Android payload mapping (LIVE-PAYLOAD.md) from the APNs-shaped bodies index.ts builds.
// Fixture = the 🧪 test game (bd37181e…, 🧪 בדיקה א vs 🧪 בדיקה ב), as the DB has it.
import { assertEquals } from "jsr:@std/assert@1";
import { type AndroidCtx, androidData, APPLE_EPOCH_S, fcmMessage, goalsString, readableHex, shortName } from "./android.ts";

const NOW = 1_792_000_000_000;
const apple = (ms: number) => ms / 1000 - APPLE_EPOCH_S;

const ctx = (live: AndroidCtx["live"] = { phase: "running", period: "2", state: { periodMS: 25 * 60_000 } }): AndroidCtx => ({
  game: {
    id: "bd37181e-8522-4600-891d-adca5dcb933d", status: "in_progress", game_date: "2026-10-20 15:00:00+00",
    venue: "אולם בדיקות", home_team_id: "59dfb3d6-5edf-4b00-984c-bef302d437f6", away_team_id: "d827a19b-ab6b-4e6a-a8b4-b27d453b424d",
  },
  live,
  events: [
    { id: "g1", type: "goal", side: "home", player: "בודק 1", timeMS: 25 * 60_000 - 252_000, period: "1" },
    { id: "f1", type: "foul", side: "away", player: "בודק 2", timeMS: 600_000, period: "1" },
    { id: "g2", type: "goal", side: "away", player: "בודק 2", timeMS: 25 * 60_000 - 300_000, period: "2" },
  ],
  home: { id: "59dfb3d6-5edf-4b00-984c-bef302d437f6", name: "🧪 בדיקה א", primary_color: "#7c3aed", logo_url: null },
  away: { id: "d827a19b-ab6b-4e6a-a8b4-b27d453b424d", name: "🧪 בדיקה ב", primary_color: "#0d9488", logo_url: null },
});

const liveBody = (extra: Record<string, unknown> = {}, t = NOW) => ({
  aps: {
    timestamp: t / 1000, event: "update",
    "content-state": {
      phase: "live", period: "second", homeScore: 1, awayScore: 1,
      clockEndsAt: apple(t + 1_200_000), clockRemaining: 1200,
      lastEvent: { kind: "goal", side: "away", player: "בודק 2", minute: 31 }, highlight: true,
      homeFouls: 0, awayFouls: 1, attending: false, ...extra,
    },
  },
});

Deno.test("live update maps to the Android data map", () => {
  const d = androidData(ctx(), liveBody(), NOW);
  assertEquals(d.type, "live_game");
  assertEquals(d.gameId, "bd37181e-8522-4600-891d-adca5dcb933d");
  assertEquals(d.status, "live");
  assertEquals(d.period, "second");
  assertEquals([d.homeScore, d.awayScore], ["1", "1"]);
  assertEquals(d.clockRunning, "1");
  assertEquals(d.clockRemainingMs, "1200000");
  assertEquals(d.clockEndsAt, String(NOW + 1_200_000));
  assertEquals(d.seq, String(NOW));
  assertEquals([d.lastEventKind, d.lastEventSide, d.lastEventPlayer, d.lastEventMinute], ["goal", "away", "בודק 2", "31"]);
  assertEquals(d.highlight, "1");
  assertEquals(d.awayFouls, "1");
  assertEquals(d.homeShort, "בדיקה א");
  assertEquals(d.homeColor, "#7c3aed");
  assertEquals(d.kickoff, String(Date.parse("2026-10-20 15:00:00+00")));
  assertEquals(d.goals, "h:252,a:1800");
  assertEquals(d.periodMs, "1500000");
  // Every value is a string (FCM data is map<string,string>), and no logo keys when null.
  for (const v of Object.values(d)) assertEquals(typeof v, "string");
  assertEquals("homeLogo" in d, false);
});

Deno.test("paused clock, timeout, halftime", () => {
  const paused = androidData(ctx({ phase: "paused", period: "2", state: {} }), liveBody({ clockEndsAt: undefined, clockRemaining: 730 }), NOW);
  assertEquals([paused.clockRunning, paused.clockRemainingMs, "clockEndsAt" in paused], ["0", "730000", false]);
  const to = androidData(ctx({ phase: "breakTime", period: "פסק זמן · 🧪 בדיקה ב", state: {} }), liveBody({ clockEndsAt: undefined, clockRemaining: 600 }), NOW);
  assertEquals(to.status, "timeout");
  assertEquals(to.periodLabel, "פסק זמן · 🧪 בדיקה ב");
  const ht = androidData(ctx({ phase: "breakTime", period: "מחצית", state: {} }), liveBody({ phase: "halftime", period: "first", clockEndsAt: undefined, clockRemaining: 0 }), NOW);
  assertEquals(ht.status, "halftime");
});

Deno.test("final vs abandoned", () => {
  const fin = { aps: { timestamp: NOW / 1000, event: "end", "dismissal-date": NOW / 1000 + 1800, "content-state": { ...liveBody().aps["content-state"], phase: "final", clockEndsAt: undefined, clockRemaining: 0 } } };
  assertEquals(androidData(ctx(null), fin, NOW).status, "final");
  const gone = { aps: { timestamp: NOW / 1000, event: "end", "dismissal-date": NOW / 1000, "content-state": { phase: "pregame", period: "first", homeScore: 0, awayScore: 0, clockRemaining: 1500, highlight: false, homeFouls: 0, awayFouls: 0, attending: false } } };
  assertEquals(androidData(ctx(null), gone, NOW).status, "ended");
});

Deno.test("suspension only while it is being served", () => {
  const s = { side: "home", player: "בודק 1", isRed: true, startedAt: apple(NOW - 60_000), endsAt: apple(NOW + 180_000) };
  const d = androidData(ctx(), liveBody({ suspension: s, lastEvent: { kind: "redCard", side: "home", player: "בודק 1", minute: 30 }, highlight: false }), NOW);
  assertEquals([d.suspSide, d.suspRed, d.suspRemainingMs, d.suspEndsAt], ["home", "1", "180000", String(NOW + 180_000)]);
  const over = androidData(ctx(), liveBody({ suspension: { ...s, endsAt: apple(NOW - 1000) } }), NOW);
  assertEquals("suspSide" in over, false);
});

Deno.test("push-to-start body (event start) is a live update", () => {
  const start = { aps: { ...liveBody().aps, event: "start", attributes: {} } };
  assertEquals(androidData(ctx(), start, NOW).status, "live");
});

Deno.test("FCM message: data-only, priority, collapse key", () => {
  const d = androidData(ctx(), liveBody(), NOW);
  const hi = fcmMessage("tok", d, 10).message;
  assertEquals(hi.android.priority, "HIGH");
  assertEquals(hi.android.collapse_key, "live_bd37181e-8522-4600-891d-adca5dcb933d");
  assertEquals("notification" in hi, false);
  assertEquals(fcmMessage("tok", d, 5).message.android.priority, "NORMAL");
  assertEquals(fcmMessage("tok", { ...d, status: "final" }, 5).message.android.priority, "HIGH");
});

Deno.test("helpers match the app", () => {
  // TeamBannerColors.readable examples from the app's doc comment.
  assertEquals(readableHex("#FFFFFF"), "#7b7f8a");
  assertEquals(readableHex("#15F919"), "#127d22");
  assertEquals(readableHex("#EA580C"), "#ea580c");
  assertEquals(readableHex("nope"), null);
  assertEquals(shortName("גבעת עדה איחוד"), "גבעת");
  assertEquals(shortName("רמת ישי"), "רמת ישי");
  assertEquals(goalsString([], 1_500_000), "");
});

// Print a real payload for the device check (inject with the app's debug receiver).
if (Deno.env.get("PRINT_PAYLOAD")) {
  const t = Date.now();
  const s = { side: "home", player: "בודק 1", isRed: true, startedAt: apple(t - 60_000), endsAt: apple(t + 180_000) };
  const d = androidData(ctx(), liveBody({ suspension: s, lastEvent: { kind: "redCard", side: "home", player: "בודק 1", minute: 30 }, highlight: false }, t), t);
  console.log(JSON.stringify(d));
}

Deno.test("goal and red card updates carry alert (sound + vibration); other updates do not", () => {
  assertEquals(androidData(ctx(), liveBody(), NOW, "goal").alert, "goal");
  const red = liveBody({ lastEvent: { kind: "redCard", side: "home", player: "בודק 1", minute: 30 }, highlight: false });
  assertEquals(androidData(ctx(), red, NOW, "redCard").alert, "redCard");
  // No buzz → no key (a clock / foul / later re-post of the same red card stays silent).
  assertEquals("alert" in androidData(ctx(), red, NOW), false);
  // Never on a final / abandoned message.
  const fin = { aps: { timestamp: NOW / 1000, event: "end", "content-state": { phase: "final", period: "second", homeScore: 2, awayScore: 1, clockRemaining: 0, highlight: false, homeFouls: 0, awayFouls: 0, attending: false } } };
  assertEquals("alert" in androidData(ctx(), fin, NOW, "goal"), false);
  // A red card is a HIGH FCM message, like a goal.
  assertEquals(fcmMessage("tok", androidData(ctx(), red, NOW, "redCard"), 10).message.android.priority, "HIGH");
});
