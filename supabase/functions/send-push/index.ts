// ============================================================================
// send-push — fan a single `notifications` row out to the recipient's devices.
//
// Called by an AFTER INSERT trigger on public.notifications (via pg_net), NOT
// by end users. Auth is a shared secret in the `x-push-secret` header, compared
// to the PUSH_WEBHOOK_SECRET env var — so verify_jwt is disabled for this fn.
//
// Three delivery channels, all best-effort:
//   • web     → Web Push protocol (VAPID)         — npm:web-push
//   • ios     → Apple Push Notification service    — hand-rolled JWT + HTTP/2 fetch
//   • android → Firebase Cloud Messaging (HTTP v1) — service-account OAuth2 + fetch
//
// Dead subscriptions (410 Gone / BadDeviceToken / Unregistered) are pruned.
// The Hebrew copy mirrors src/lib/notifications.js so a push reads exactly like
// the in-app bell.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // auto-injected
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET")!;

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@rinkhockeyil.com";

const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID")!;
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID")!;
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID")!;
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY")!; // .p8 contents (PKCS8 PEM)

// FCM (Android) — OPTIONAL. Absent until Firebase is provisioned, so the function
// keeps delivering web+iOS push before Android is wired (the android branch is
// skipped when FCM_CONFIGURED is false). All three come from the Firebase
// service-account JSON (Project settings → Service accounts → Generate new key).
// A single-line env var stores the PEM with literal "\n" → un-escape to real NLs.
const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID") ?? "";
const FCM_CLIENT_EMAIL = Deno.env.get("FCM_CLIENT_EMAIL") ?? "";
const FCM_PRIVATE_KEY = (Deno.env.get("FCM_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
const FCM_CONFIGURED = !!(FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY);

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- Hebrew copy (ported from src/lib/notifications.js) --------------------
// `medic` and `league_manager` were missing here while src/lib/notifications.js had
// them — so an official_* push for a חובש rendered "שובצת כundefined למשחק".
const ROLE_LABEL: Record<string, string> = {
  player: "שחקן", coach: "מאמן", content_editor: "עורך תוכן", judge: "שופט",
  league_manager: "מנהל ליגה", medic: "חובש", developer: "מפתח/ת",
};

function bodyPreview(n: NotificationRow): string {
  // The devices this reaches are, by definition, running a build old enough to predate
  // the in-app update banner — and a tap lands them on the bell, which offers no
  // download. The body is their only actual instruction, so spell out where to go.
  if (n.type === "app_update") {
    const note = (n.data?.note ?? "").toString().trim();
    return note || "היכנסו ל-rinkhockeyil.com/app להורדת הגרסה החדשה";
  }
  // Admin broadcast (admin_broadcast_notification): the admin wrote the words.
  if (n.type === "announcement") return (n.data?.body ?? n.data?.preview ?? "").toString();
  return (n.data?.preview ?? "").toString();
}

// Kept in sync with src/lib/notifications.js — this file is a deliberate duplicate,
// because the edge function cannot import from the Vite bundle.
const kickoff = (d: Record<string, any>) => (d.game_date
  ? new Date(d.game_date).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })
  : "");
const vs = (d: Record<string, any>) => `${d.home_team ?? ""} נגד ${d.away_team ?? ""}`.trim();

// F1 — player availability constraints. Mirrors src/lib/notifications.js.
const UNAVAILABILITY_KIND: Record<string, string> = {
  injury: "פציעה", abroad: "שהות בחו״ל", reserve_duty: "מילואים", other: "סיבה אחרת",
};
const unavailKind = (k: string) => UNAVAILABILITY_KIND[k] ?? "אי-זמינות";
const unavailDay = (v: any) => (v ? new Date(v).toLocaleDateString("he-IL") : "");
const unavailSpan = (d: Record<string, any>) =>
  d.ends_on ? `${unavailDay(d.starts_on)}–${unavailDay(d.ends_on)}` : `מ־${unavailDay(d.starts_on)}`;

// Israel time, explicitly: the edge runtime is UTC, so without timeZone the push said
// 14:30 for a 16:30 game.
function movedSummary(d: Record<string, any>): string {
  const when = d.game_date
    ? new Date(d.game_date).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  // reconfirm: a real move (another day / >2h) — every מגיע / לא מגיע was flagged and
  // has to be given again (game-postpone-reconfirm.sql).
  const ask = d.reconfirm ? " — נא לאשר הגעה מחדש" : "";
  if (d.from_postponed) return `נקבע מועד חדש: ${when}${d.what === "both" ? ` ב${d.venue ?? "מגרש אחר"}` : ""}${ask}`;
  if (d.what === "venue") return `המשחק עבר ל${d.venue ?? "מגרש אחר"}`;
  if (d.what === "time")  return `המשחק הועבר ל־${when}${ask}`;
  return `המשחק עבר ל${d.venue ?? "מגרש אחר"} ול־${when}${ask}`;
}

function officialsSummary(d: Record<string, any>): string {
  const missing: string[] = [];
  if (!(d.judges > 0)) missing.push("שופט");
  if (!(d.medics > 0)) missing.push("חובש");
  return missing.length ? `חסר ${missing.join(" ו")}` : "שופט וחובש משובצים ✅";
}

// official_role_* rows carry the two boxes the user ticked (official-role-requests.sql).
function officialWord(d: Record<string, any>): string {
  return d.wants_referee && d.wants_secretary ? "שופט ומזכירות" : d.wants_secretary ? "מזכירות" : "שופט";
}

function notificationText(n: NotificationRow, actorName: string): string {
  const d = n.data ?? {};
  switch (n.type) {
    // Admin broadcast — title as written, 📣 like the bell (docs/HIDDEN-FEATURES-SPEC.md).
    case "announcement":   return `📣 ${(d.title ?? "").toString().trim() || "הודעה מהליגה"}`;
    case "app_update":
      return `גרסה חדשה של האפליקציה זמינה${d.version_name ? ` (${d.version_name})` : ""}`;
    case "post_like":      return `${actorName} אהב/ה את הפוסט שלך`;
    case "post_comment":   return `${actorName} הגיב/ה על הפוסט שלך`;
    case "tagged":         return `${actorName} תייג/ה אותך ${d.where === "comment" ? "בתגובה" : "בפוסט"}`;
    case "claim_approved": return `הבקשה שלך להתחבר לשחקן ${d.player_name ?? ""} אושרה 🎉`;
    case "claim_rejected": return `הבקשה שלך להתחבר לשחקן ${d.player_name ?? ""} נדחתה${d.reason ? ` — ${d.reason}` : ""}`;
    case "role_granted":   return `קיבלת תפקיד: ${ROLE_LABEL[d.role] ?? d.role ?? ""}`;
    case "claim_request":  return `${d.claimant ?? "משתמש"} מבקש/ת להתחבר לשחקן ${d.player_name ?? ""}`;
    case "content_report": return `דווח תוכן${d.reason ? ` — ${d.reason}` : ""}`;
    // away:home, like the bell — the digits run LTR inside an RTL line (RTL score gotcha)
    case "game_result":    return `תוצאה: ${d.home_team ?? ""} ${d.away_score ?? ""}:${d.home_score ?? ""} ${d.away_team ?? ""}`;
    case "game_change_request":  return `${actorName} מבקש/ת שינוי במשחק ${d.home_team ?? ""} נגד ${d.away_team ?? ""}${d.reason ? ` — ${d.reason}` : ""}`;
    case "game_change_approved": return `בקשתך לשינוי המשחק ${d.home_team ?? ""} נגד ${d.away_team ?? ""} אושרה 🎉${d.decision_note ? ` — ${d.decision_note}` : ""}`;
    case "game_change_rejected": return `בקשתך לשינוי המשחק ${d.home_team ?? ""} נגד ${d.away_team ?? ""} נדחתה${d.decision_note ? ` — ${d.decision_note}` : ""}`;
    case "team_join_request":    return `${actorName} מבקש/ת להצטרף לקבוצת ${d.team_name ?? ""}`;
    case "team_join_approved":   return `בקשתך להצטרף לקבוצת ${d.team_name ?? ""} אושרה 🎉`;
    case "team_join_rejected":   return `בקשתך להצטרף לקבוצת ${d.team_name ?? ""} נדחתה`;
    case "player_submission_request":  return `${actorName} הגיש/ה כרטיס שחקן חדש${d.candidate_name ? `: ${d.candidate_name}` : ""}${d.team_name ? ` — ${d.team_name}` : ""}`;
    case "player_submission_approved": return `כרטיס השחקן ${d.candidate_name ?? ""} שהגשת אושר 🎉`;
    case "player_submission_rejected": return `כרטיס השחקן ${d.candidate_name ?? ""} נדחה${d.reason ? ` — ${d.reason}` : ""}`;
    case "medical_submitted":    return `${d.player_name ?? actorName} העלה/תה אישור רפואי הממתין לאישור`;
    // Stage 2 — the coach signed off; the league manager still has to verify פודיום.
    // These three shipped with bell copy only, so their pushes said "התראה חדשה".
    case "medical_pending_manager": return `${d.player_name || "שחקן"}${d.team_name ? ` (${d.team_name})` : ""} — המאמן אישר את הבדיקה, ממתין לאימות רישום בפודיום`;
    case "medical_coach_approved":  return `המאמן אישר את הבדיקה הרפואית שלך — ממתין לאישור המנהלת`;
    case "medical_reinspection":    return `${d.count ?? ""} אישורים רפואיים הוחזרו לבדיקה חוזרת — השחקנים חסומים עד לאישורם`;
    case "medical_approved":     return `האישור הרפואי שלך אושר ✅`;
    case "medical_rejected":     return `האישור הרפואי שלך נדחה — יש להעלות מחדש`;
    case "medical_expiring":     return `האישור הרפואי שלך יפוג בעוד ${d.days_left ?? ""} ימים — מומלץ לחדש`;
    case "medical_expiring_player": return `האישור הרפואי של ${d.player_name ?? "שחקן"} יפוג בעוד ${d.days_left ?? ""} ימים`;
    // F1 — player availability constraints (player_unavailability). Kind is a stable
    // English token in the DB; only the label is Hebrew, so web and native agree.
    case "coach_open_items": return `ממתין לטיפולך: ${d.summary ?? ""}${(d.oldest_days ?? 0) > 0 ? ` — הוותיק ביותר כבר ${d.oldest_days} ימים` : ""}`;
    case "unavailability_reported": return `${d.player_name ?? actorName} דיווח/ה על אי-זמינות (${unavailKind(d.kind)}) ${unavailSpan(d)} — ממתין לאישורך`;
    case "unavailability_approved": return `דיווח אי-הזמינות שלך (${unavailKind(d.kind)}) ${unavailSpan(d)} אושר ✅${d.decision_note ? ` — ${d.decision_note}` : ""}`;
    case "unavailability_rejected": return `דיווח אי-הזמינות שלך (${unavailKind(d.kind)}) ${unavailSpan(d)} נדחה${d.decision_note ? ` — ${d.decision_note}` : ""}`;
    case "medical_revoked":      return `האישור הרפואי ${d.player_name ? `של ${d.player_name} ` : ""}בוטל${d.reason ? ` — ${d.reason}` : ""}`;
    case "medical_date_changed": return `תאריך הבדיקה עודכן — האישור בתוקף עד ${d.expires_at ? new Date(d.expires_at).toLocaleDateString("he-IL") : ""}`;
    case "game_change_opponent": return `${actorName} מבקש/ת שינוי מועד — יש לבחור מועד שמתאים לך${d.reason ? ` (${d.reason})` : ""}`;
    case "coach_request":          return `${d.requester ?? actorName} מבקש/ת להיות מאמן/ת של ${d.team_name ?? "קבוצה"}`;
    case "coach_request_rejected": return `בקשתך להיות מאמן/ת של ${d.team_name ?? "קבוצה"} נדחתה`;
    // supabase/official-role-requests.sql + card-unlink-requests.sql — keep in step with src/lib/notifications.js
    case "official_role_request":  return `${d.requester ?? actorName} מבקש/ת תפקיד ${officialWord(d)}`;
    case "official_role_approved": return `בקשתך לתפקיד ${officialWord(d)} אושרה 🎉`;
    case "official_role_rejected": return `בקשתך לתפקיד ${officialWord(d)} נדחתה`;
    case "card_unlink_request":    return `${d.requester ?? actorName} מבקש/ת להתנתק מהכרטיס ${d.player_name ?? ""}${d.reason ? ` — ${d.reason}` : ""}`;
    case "card_unlink_approved":   return `החשבון נותק מהכרטיס ${d.player_name ?? ""}`;
    case "card_unlink_rejected":   return `בקשת הניתוק מהכרטיס ${d.player_name ?? ""} נדחתה`;
    case "official_assigned":              return `שובצת כ${ROLE_LABEL[d.role] ?? "בעל תפקיד"} למשחק`;
    case "official_application":           return `${actorName} הגיש/ה מועמדות כ${ROLE_LABEL[d.role] ?? "בעל תפקיד"}`;
    case "official_application_approved":  return `מועמדותך לשיבוץ כ${ROLE_LABEL[d.role] ?? "בעל תפקיד"} אושרה 🎉`;
    case "official_application_rejected":  return `מועמדותך לשיבוץ כ${ROLE_LABEL[d.role] ?? "בעל תפקיד"} נדחתה`;
    case "tournament_invite":          return `קבוצת ${d.team_name ?? ""} הוזמנה לטורניר ${d.tournament_name ?? ""}`;
    case "tournament_invite_accepted": return `קבוצת ${d.team_name ?? ""} אישרה השתתפות בטורניר ${d.tournament_name ?? ""} 🎉`;
    case "tournament_invite_declined": return `קבוצת ${d.team_name ?? ""} דחתה את ההזמנה לטורניר ${d.tournament_name ?? ""}`;
    // Scheduled game reminders (P2). These MUST say what to do — a reminder that lands
    // on the lock screen as "התראה חדשה" is the one notification where a generic
    // fallback defeats the entire point of sending it.
    // Loan invites — keep in step with src/lib/notifications.js.
    // The fan waiting room (stream-request-approved-push.sql): keep in step with src/lib/notifications.js.
    case "stream_approved":    return `אושרת לשדר את ${vs(d)} 🎥 — לחצו כדי להתחיל לשדר`;
    case "loan_call":          return `${d.team_name ?? "קבוצה"} מחפשת ${d.need === "gk" ? "שוער" : "שחקן שדה"} בהשאלה למשחק ${vs(d)} — רוצה לשחק?`;
    case "loan_join_request":  return `${d.player_name ?? "שחקן"}${d.age != null ? ` (${d.age})` : ""} מבקש/ת לשחק בהשאלה ב${d.team_name ?? "קבוצה"} — ${vs(d)}`;
    case "loan_join_approved": return `אושרת! את/ה בסגל של ${d.team_name ?? "הקבוצה"} למשחק ${vs(d)} 🎉`;
    case "loan_join_declined": return `${d.team_name ?? "הקבוצה"} לא אישרה את הבקשה להשאלה למשחק ${vs(d)}`;
    case "loan_request":   return `${d.team_name ?? "קבוצה"} מזמינה אותך לשחק בהשאלה: ${vs(d)} — לאישור או דחייה`;
    case "loan_accepted":  return `${d.player_name ?? "השחקן"} אישר/ה — משחק/ת בהשאלה ב${d.team_name ?? "קבוצה"} (${vs(d)}) ✅`;
    case "loan_declined":  return d.withdrew
      ? `${d.player_name ?? "השחקן"} יצא/ה מהסגל (השאלה) למשחק ${vs(d)}`
      : `${d.player_name ?? "השחקן"} לא יכול/ה להגיע בהשאלה למשחק ${vs(d)}`;
    case "loan_cancelled": return d.reason === "filled"
      ? `הסגל של ${d.team_name ?? "הקבוצה"} התמלא — ההזמנה להשאלה (${vs(d)}) בוטלה`
      : `${d.team_name ?? "הקבוצה"} ביטלה את ההזמנה להשאלה למשחק ${vs(d)}`;
    case "loan_removed":   return d.for_coach
      ? `${d.player_name ?? "השחקן"} הוסר/ה מהסגל — יש כבר ${d.own_field ?? 5} שחקני שדה של הקבוצה (${vs(d)})`
      : `נרשמו מספיק שחקנים ב${d.team_name ?? "קבוצה"}, ולכן הוסרת מהסגל למשחק ${vs(d)}. תודה!`;
    case "game_register_reminder": return `משחק מתקרב: ${vs(d)} — נא לסמן הגעה`;
    case "game_register_nudge":    return `עדיין לא סימנת הגעה למשחק ${vs(d)}`;
    case "game_form_sign":         return `המשחק ${vs(d)} הסתיים — חסרה החתימה שלך על טופס המשחק`;
    case "coach_squad_digest":     return `סגל למשחק ${vs(d)}: ${d.yes ?? 0} מגיעים, ${d.no ?? 0} לא מגיעים, ${d.pending ?? 0} טרם הגיבו`;
    case "lm_squad_digest":        return `סגלים למשחק ${vs(d)}: ${d.home_team ?? "בית"} ${d.home_count ?? 0}, ${d.away_team ?? "חוץ"} ${d.away_count ?? 0}`;
    case "lm_officials_digest":    return `${vs(d)} — ${officialsSummary(d)}`;
    case "lm_broadcast":           return `הודעת מנהל הליגה (${vs(d)}): ${d.message ?? ""}`;
    case "game_moved":             return `${vs(d)} — ${movedSummary(d)}`;
    case "game_postponed":         return `${vs(d)} — המשחק נדחה, מועד חדש יפורסם`;
    case "follow_game_alert":      return `מחר: ${vs(d)}`;
    case "follow_game_today":      return `היום ב־${kickoff(d)}: ${vs(d)}`;
    case "goal_scored":            return `${d.scoring_team ?? ""} הבקיעה! ${vs(d)} ${d.away_score ?? ""}:${d.home_score ?? ""}`;
    // סטופר מרקט. A settlement push IS the payoff — landing it as "התראה חדשה"
    // would waste the one notification that brings a trader back to the board.
    case "market_resolved":
      return Number(d.won) > 0
        ? `${d.title ?? "שוק"} הוכרע: ${d.outcome ?? ""} — צדקת! קיבלת ${Math.round(Number(d.won))} סטופרים 🎉`
        : `${d.title ?? "שוק"} הוכרע: ${d.outcome ?? ""} — הפעם התחזית לא התממשה`;
    case "market_coins":
      return Number(d.delta) >= 0
        ? `קיבלת ${Math.round(Number(d.delta))} סטופרים בסטופר מרקט${d.reason ? ` — ${d.reason}` : ""}`
        : `הופחתו ${Math.abs(Math.round(Number(d.delta)))} סטופרים מהיתרה שלך בסטופר מרקט${d.reason ? ` — ${d.reason}` : ""}`;
    default:               return "התראה חדשה";
  }
}

// KEEP THESE AS UUIDs. DO NOT "modernise" them to the Hebrew slugs the website
// now uses (/players/יואב-תורגמן).
//
// This path is not only a web link — it is shipped inside the push payload as
// `url`, and BOTH native apps parse it and treat the second segment as a row id:
//   Android  PushRouter.toRoute()            -> Routes.player(<segment>)
//   iOS      NotificationDestination.parse() -> .player(<segment>)
// Each then resolves that id against rows it already holds, matching on `.id`.
// Hand them a slug and the match simply never succeeds: no crash, no error, no
// log line — just a screen that spins forever. It would look like a broken app,
// not like a bad link.
//
// The UUID form is safe on the web too: rinkhockeyil.com 308-redirects every
// /players/<uuid> to its slug (api/resolve.js), so browsers and the digest email
// still land on the pretty URL.
//
// Changing this contract means shipping new iOS and Android builds FIRST, and
// waiting for people to install them — remember the Android app is sideloaded.
function notificationHref(n: NotificationRow): string {
  const d = n.data ?? {};
  switch (n.type) {
    case "claim_approved":
    case "claim_rejected": return n.entity_id ? `/players/${n.entity_id}` : "/me";
    case "role_granted":   return "/me";
    // a team's call for players → the youth loan page (web only for now; the apps
    // fall back to their default screen until they learn the route)
    case "loan_call":      return "/loans";
    // Approved to stream → the game; `section: "broadcast"` (below) takes new apps on to the
    // broadcast screen, older ones stay on the game page, which has the "שדר" button.
    case "stream_approved": return n.entity_id ? `/games/${n.entity_id}` : "/games";
    case "app_update":     return "/app";
    // Reviewer queues: land on the TAB (and, inside the stacked claims tab, the
    // SECTION) the notification is about. A bare /admin opens whichever tab happens to
    // be first, and the reviewer has to go hunting. Both apps read `tab` too.
    case "claim_request":          return "/admin?tab=claims&section=claims";
    case "content_report":         return "/admin?tab=reports";
    case "game_change_request":    return "/admin?tab=game_requests";
    case "coach_request":          return "/admin?tab=claims&section=coaches";
    case "official_role_request":  return "/admin?tab=claims&section=officials";
    case "card_unlink_request":    return "/admin?tab=claims&section=unlinks";
    case "official_role_approved":
    case "official_role_rejected":
    case "card_unlink_approved":
    case "card_unlink_rejected":   return "/me";
    case "official_application":   return "/admin?tab=officials";
    case "team_join_request":          return "/admin?tab=claims&section=joins";
    case "player_submission_request":  return "/admin?tab=claims&section=submissions";
    case "medical_submitted":          return "/admin?tab=claims&section=medical";
    case "medical_pending_manager":
    case "medical_reinspection":   return "/admin?tab=medical";
    case "medical_expiring_player": return "/admin?tab=claims&section=medical";
    // the recipient is the coach the report is waiting on — land him on the queue
    case "coach_open_items": return `/admin?tab=${d.tab ?? n.entity_id ?? "claims"}`;
    case "unavailability_reported": return "/admin?tab=unavailability";
    case "game_result":
    case "game_change_opponent":
    case "game_change_approved":
    case "game_change_rejected":
    case "official_assigned":
    case "official_application_approved":
    case "official_application_rejected":
    case "game_register_reminder":
    case "game_register_nudge":
    case "game_form_sign":
    case "coach_squad_digest":
    case "lm_squad_digest":
    case "lm_officials_digest":
    case "lm_broadcast":
    case "game_moved":
    case "game_postponed":
    case "follow_game_alert":
    case "follow_game_today":
    case "goal_scored":
    case "loan_join_request":
    case "loan_join_approved":
    case "loan_join_declined":
    case "loan_request":
    case "loan_accepted":
    case "loan_declined":
    case "loan_cancelled":
    case "loan_removed":           return n.entity_id ? `/games/${n.entity_id}` : "/games";
    case "coach_request_rejected":
    case "team_join_approved":
    case "team_join_rejected":     return n.entity_id ? `/teams/${n.entity_id}` : "/me";
    case "player_submission_approved": return d.player_id ? `/players/${d.player_id}` : "/me";
    case "player_submission_rejected":
    case "medical_approved":
    case "medical_rejected":
    case "medical_coach_approved":
    case "medical_expiring":
    case "medical_date_changed":
    case "unavailability_approved":
    case "unavailability_rejected": return "/me";
    // the coach's copy is about one of his players, not about him
    case "medical_revoked":        return d.for_coach && n.entity_id ? `/players/${n.entity_id}` : "/me";
    case "tournament_invite":
    case "tournament_invite_accepted":
    case "tournament_invite_declined": return n.entity_id ? `/tournaments/${n.entity_id}` : "/tournaments";
    case "market_resolved":        return n.entity_id ? `/market/${n.entity_id}` : "/market";
    case "market_coins":           return "/market";
    case "post_like":
    case "post_comment":           return n.entity_id ? `/#post-${n.entity_id}` : "/";
    // set_mentions computes the destination (post page, game page, or the feed card).
    case "tagged":                 return typeof n.data?.href === "string" && n.data.href.startsWith("/") ? n.data.href : "/";
    // the admin's optional link (the RPC only accepts in-app paths); none → the feed
    case "announcement":           return typeof d.href === "string" && d.href.startsWith("/") && !d.href.startsWith("//") ? d.href : "/";
    default:               return "/";
  }
}

// ---- APNs auth token (ES256 JWT, cached ~50 min) ---------------------------
function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

let apnsKeyPromise: Promise<CryptoKey> | null = null;
function apnsSigningKey(): Promise<CryptoKey> {
  if (!apnsKeyPromise) {
    apnsKeyPromise = crypto.subtle.importKey(
      "pkcs8", pemToPkcs8(APNS_PRIVATE_KEY),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
    );
  }
  return apnsKeyPromise;
}

let cachedToken: { jwt: string; at: number } | null = null;
async function apnsAuthToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.at < 3000) return cachedToken.jwt; // reuse < 50 min
  const header = b64urlFromString(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }));
  const payload = b64urlFromString(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, await apnsSigningKey(),
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64urlFromBytes(new Uint8Array(sig))}`;
  cachedToken = { jwt, at: now };
  return jwt;
}

// The sign-up pushes that get מגיע / לא מגיע buttons, and the first Android build that
// draws them (versionCode). Must match the release that ships AvailabilityPush.kt.
const AVAILABILITY_TYPES = new Set(["game_register_reminder", "game_register_nudge"]);
const AVAILABILITY_ACTIONS_MIN_ANDROID = 64;

async function sendApns(
  deviceToken: string, environment: string | null,
  title: string, body: string, url: string, badge: number, section: string | null,
  availabilityGameId: string | null = null,
): Promise<{ ok: boolean; prune: boolean; detail?: string }> {
  const jwt = await apnsAuthToken();
  // A sign-up push names the category the app registered its מגיע / לא מגיע buttons
  // under (AvailabilityPushActions.swift). Builds without it ignore the category.
  const aps = {
    aps: {
      alert: { title, body }, sound: "default", badge, "thread-id": "rinkhockeyil",
      ...(availabilityGameId ? { category: "GAME_AVAILABILITY" } : {}),
    },
    url,
    ...(section ? { section } : {}),
    ...(availabilityGameId ? { game_id: availabilityGameId } : {}),
  };
  const hosts = environment === "sandbox"
    ? ["api.sandbox.push.apple.com"]
    : ["api.push.apple.com", "api.sandbox.push.apple.com"]; // prod first, sandbox fallback
  let prune = false;
  let detail = "";
  for (const host of hosts) {
    const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify(aps),
    });
    if (res.ok) return { ok: true, prune: false, detail: host.includes("sandbox") ? "sandbox" : undefined };
    const reason = await res.text();
    detail = `${res.status} ${reason}`.slice(0, 200);
    // 400 BadDeviceToken on prod usually means the token is a sandbox token → retry sandbox.
    if (res.status === 400 && reason.includes("BadDeviceToken") && host === "api.push.apple.com") {
      continue;
    }
    // Token is permanently invalid → prune it.
    if (res.status === 410 || reason.includes("Unregistered") || reason.includes("BadDeviceToken")) {
      prune = true;
    }
    console.log(`APNs ${host} -> ${res.status} ${reason}`);
    return { ok: false, prune, detail };
  }
  return { ok: false, prune, detail };
}

// ---- FCM HTTP v1 (Android) -------------------------------------------------
// Google shut off the legacy server-key API (2024), so we use HTTP v1: mint an
// OAuth2 access token from the service account (RS256 JWT → Google token endpoint),
// cache it ~55 min, then POST the message. Reuses the b64url + pemToPkcs8 helpers.

let fcmKeyPromise: Promise<CryptoKey> | null = null;
function fcmSigningKey(): Promise<CryptoKey> {
  if (!fcmKeyPromise) {
    fcmKeyPromise = crypto.subtle.importKey(
      "pkcs8", pemToPkcs8(FCM_PRIVATE_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
  }
  return fcmKeyPromise;
}

let fcmToken: { access: string; exp: number } | null = null;
async function fcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmToken && now < fcmToken.exp - 300) return fcmToken.access; // reuse until 5 min before expiry
  const header = b64urlFromString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlFromString(JSON.stringify({
    iss: FCM_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, await fcmSigningKey(),
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${b64urlFromBytes(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`FCM token ${res.status} ${await res.text()}`);
  const j = await res.json();
  fcmToken = { access: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return fcmToken.access;
}

async function sendFcm(
  deviceToken: string, title: string, body: string, url: string, section: string | null,
  availabilityGameId: string | null = null,
): Promise<{ ok: boolean; prune: boolean; detail?: string }> {
  const access = await fcmAccessToken();
  // notification + data: the `notification` block makes Android render it in the
  // tray even when the app is killed (reliable app-closed delivery); `data.url`
  // carries the deep link (tap → launcher intent extras / onMessageReceived).
  //
  // A sign-up push to a build that can draw buttons goes DATA-ONLY instead: Android
  // draws a `notification` message itself, with no buttons, whenever the app is not in
  // the foreground. Data-only always reaches HockeyMessagingService, which draws it
  // with מגיע / לא מגיע (push/AvailabilityPush.kt).
  const message = availabilityGameId
    ? {
      message: {
        token: deviceToken,
        data: {
          type: "availability", title, body, url, game_id: availabilityGameId,
          ...(section ? { section } : {}),
        },
        android: { priority: "high" },
      },
    }
    : {
      message: {
        token: deviceToken,
        notification: { title, body },
        data: { url, type: "bell", ...(section ? { section } : {}) },
        android: {
          priority: "high",
          notification: { channel_id: "rinkhockeyil_default", default_sound: true },
        },
      },
    };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify(message),
    },
  );
  if (res.ok) return { ok: true, prune: false };
  const reason = await res.text();
  console.log(`FCM -> ${res.status} ${reason}`);
  // Token permanently invalid → prune. UNREGISTERED (app uninstalled / token
  // rotated) is a 404; a malformed token is a 400 with INVALID_ARGUMENT.
  const prune = res.status === 404 || reason.includes("UNREGISTERED") ||
    reason.includes("SENDER_ID_MISMATCH");
  return { ok: false, prune, detail: `${res.status} ${reason}`.slice(0, 200) };
}

// ---- types -----------------------------------------------------------------
interface NotificationRow {
  id: string; user_id: string; type: string; actor_id: string | null;
  entity_type: string | null; entity_id: string | null;
  data: Record<string, any> | null;
}
interface PushSub {
  id: string; platform: "web" | "ios" | "android"; endpoint: string;
  keys: { p256dh: string; auth: string } | null; environment: string | null;
  app_version: number | null; app_version_name: string | null; user_agent: string | null;
}

// ---- delivery log ----------------------------------------------------------
// One public.push_deliveries row per device tried (or one row saying why nothing
// was tried) — the /admin "התראות" tracker reads it. Best-effort: a failed log
// write must never cost a push, so it is awaited only to keep the isolate alive.
type Delivery = {
  subscription_id?: string | null; platform: string; status: string;
  detail?: string | null; app_version_name?: string | null; user_agent?: string | null;
};
async function logDeliveries(n: NotificationRow, rows: Delivery[]) {
  if (!rows.length) return;
  try {
    const { error } = await admin.from("push_deliveries").insert(rows.map((r) => ({
      notification_id: n.id ?? null, user_id: n.user_id,
      subscription_id: r.subscription_id ?? null, platform: r.platform, status: r.status,
      detail: r.detail ? String(r.detail).slice(0, 300) : null,
      app_version_name: r.app_version_name ?? null,
      user_agent: r.user_agent ? String(r.user_agent).slice(0, 300) : null,
    })));
    if (error) console.log("delivery log error", error.message);
  } catch (e) {
    console.log("delivery log threw", (e as Error)?.message ?? String(e));
  }
}


// ---- email fallback, digest only ------------------------------------------
// A coach with no registered device never sees the daily chase, and the whole
// point of the chase is that it cannot be missed. ONLY coach_open_items falls
// back to email: mailing every goal and squad change would turn a useful nudge
// into a mailing list nobody reads. Sent through the same Resend domain the
// auth mail already uses, so it is a sender players recognise.
const SITE = "https://rinkhockeyil.com";
const LOGO = `${SITE}/logos/main-logo.png`;

const Q_TITLE: Record<string, string> = {
  medical: "אישורים רפואיים", claim: "בקשות שיוך לשחקן",
  submission: "כרטיסי שחקן חדשים", join: "בקשות הצטרפות לקבוצה",
  unavailability: "בקשות היעדרות",
};
const Q_ACTION: Record<string, string> = {
  medical: "אישור הבדיקה", claim: "אישור השיוך", submission: "אישור הכרטיס",
  join: "אישור ההצטרפות", unavailability: "אישור ההיעדרות",
};
const Q_TAB: Record<string, string> = {
  medical: "claims", claim: "claims", submission: "claims",
  join: "claims", unavailability: "unavailability",
};
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const heDays = (d: number) =>
  d <= 0 ? "היום" : d === 1 ? "יום אחד" : `<span dir="ltr">${d}</span> ימים`;

function digestEmailHtml(n: NotificationRow, coachName: string): string {
  const d = n.data ?? {};
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const team = d.team_name ? esc(d.team_name) : "";
  const groups = new Map<string, any[]>();
  for (const it of items) {
    const q = String(it.queue ?? "medical");
    if (!groups.has(q)) groups.set(q, []);
    groups.get(q)!.push(it);
  }
  const hidden = Math.max(Number(d.total ?? items.length) - items.length, 0);

  const sections = [...groups.entries()].map(([q, rows]) => {
    const tab = Q_TAB[q] ?? "claims";
    const body = rows.map((it, i) => {
      const last = i === rows.length - 1;
      const nameCell = it.player_id
        ? `<a href="${SITE}/players/${esc(it.player_id)}" style="font-size:15px;color:#0f1729;font-weight:bold;text-decoration:none;">${esc(it.name)}</a>`
        : `<span style="font-size:15px;color:#0f1729;font-weight:bold;">${esc(it.name)}</span>`;
      return `<tr><td dir="rtl" style="padding:13px 16px;text-align:right;${last ? "" : "border-bottom:1px solid #eef0f6;"}">
        ${nameCell}
        <div style="font-size:13px;color:#646e8c;margin-top:3px;">ממתין ${heDays(Number(it.days ?? 0))} · <a href="${SITE}/admin?tab=${tab}" style="color:#3b4fc4;text-decoration:none;">${Q_ACTION[q] ?? "לטיפול"}</a></div>
      </td></tr>`;
    }).join("");
    return `<tr><td dir="rtl" style="padding:14px 40px 6px;text-align:right;">
        <a href="${SITE}/admin?tab=${tab}" style="font-size:15px;font-weight:bold;color:#3b4fc4;text-decoration:none;">${Q_TITLE[q] ?? "ממתין לטיפול"} ›</a>
      </td></tr>
      <tr><td style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e6f0;border-radius:12px;">${body}</table></td></tr>`;
  }).join("");

  const more = hidden > 0
    ? `<tr><td dir="rtl" style="padding:10px 40px 0;text-align:right;"><span style="font-size:13px;color:#646e8c;">ועוד <span dir="ltr">${hidden}</span> פריטים.</span></td></tr>`
    : "";

  return `<div dir="rtl" style="margin:0;padding:0;background:#f6f7fb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:28px 12px;font-family:Arial,Helvetica,'Segoe UI',sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e6f0;box-shadow:0 6px 24px rgba(15,23,41,0.06);">
        <tr><td style="height:6px;background:#3b4fc4;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:28px 24px 8px;">
          <a href="${SITE}" style="text-decoration:none;"><img src="${LOGO}" width="84" height="84" alt="ליגת הוקי הגלגיליות הישראלית" style="display:block;border:0;width:84px;height:84px;border-radius:50%;"></a>
        </td></tr>
        <tr><td align="center" style="padding:0 24px 4px;">
          <a href="${SITE}" style="text-decoration:none;"><span style="font-size:18px;font-weight:bold;color:#0f1729;letter-spacing:-0.2px;">ליגת הוקי הגלגיליות הישראלית</span></a>
        </td></tr>
        <tr><td dir="rtl" style="padding:16px 40px 4px;text-align:right;">
          <h1 style="margin:0 0 10px;font-size:23px;line-height:1.35;color:#0f1729;font-weight:bold;">ממתין לטיפולך</h1>
          <p style="margin:0 0 4px;font-size:15px;line-height:1.75;color:#2d3752;">שלום ${esc(coachName)}, יש פריטים${team ? ` בקבוצת <strong>${team}</strong>` : ""} שממתינים לאישורך. עד שלא יטופלו, השחקנים האלה לא יוכלו להירשם למשחקים.</p>
        </td></tr>
        ${sections}
        ${more}
        <tr><td align="center" style="padding:22px 40px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#3b4fc4;border-radius:11px;">
              <a href="${SITE}/admin?tab=${esc(d.tab ?? "claims")}" style="display:inline-block;padding:15px 46px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">מעבר לטיפול</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td dir="rtl" style="padding:18px 40px 2px;text-align:right;">
          <p style="margin:0;font-size:12.5px;line-height:1.7;color:#646e8c;">התזכורת נשלחת מדי יום ב-<span dir="ltr">19:00</span> ותיפסק מעצמה ברגע שלא יישארו פריטים פתוחים.</p>
          <p style="margin:10px 0 0;font-size:12.5px;line-height:1.7;color:#646e8c;">קיבלת מייל ולא התראה לנייד כי לא רשום לחשבונך מכשיר. <a href="${SITE}/app" style="color:#3b4fc4;text-decoration:none;font-weight:bold;">התקנת האפליקציה</a> ואישור התראות יחליפו את המייל בהתראה.</p>
        </td></tr>
        <tr><td style="padding:22px 40px 30px;">
          <div style="border-top:1px solid #eef0f6;padding-top:20px;text-align:center;">
            <a href="${SITE}" style="text-decoration:none;"><img src="${LOGO}" width="48" height="48" alt="ליגת הוקי הגלגיליות הישראלית" style="display:block;margin:0 auto 10px;border:0;width:48px;height:48px;border-radius:50%;"></a>
            <a href="${SITE}" style="text-decoration:none;"><span style="font-size:13px;color:#646e8c;font-weight:bold;">ליגת הוקי הגלגיליות הישראלית</span></a>
            <div style="font-size:12px;margin-top:9px;">
              <a href="${SITE}" style="color:#3b4fc4;text-decoration:none;">האתר</a><span style="color:#c8cdde;">&nbsp;·&nbsp;</span>
              <a href="${SITE}/admin?tab=claims" style="color:#3b4fc4;text-decoration:none;">עמוד הניהול</a><span style="color:#c8cdde;">&nbsp;·&nbsp;</span>
              <a href="${SITE}/app" style="color:#3b4fc4;text-decoration:none;">האפליקציה</a>
            </div>
            <div style="font-size:11px;color:#949cb6;margin-top:12px;">הודעה זו נשלחה באופן אוטומטי — אין להשיב לה.</div>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;
}

async function emailDigestFallback(admin: any, n: NotificationRow): Promise<boolean> {
  if (n.type !== "coach_open_items") return false;
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) { console.log("digest email: RESEND_API_KEY missing"); return false; }
  try {
    const { data: u } = await admin.auth.admin.getUserById(n.user_id);
    const to = u?.user?.email;
    if (!to) { console.log("digest email: no address for user"); return false; }
    const { data: prof } = await admin
      .from("profiles").select("display_name").eq("id", n.user_id).maybeSingle();
    const name = prof?.display_name ?? "";
    const d = n.data ?? {};
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ליגת הוקי הגלגיליות הישראלית <noreply@send.rinkhockeyil.com>",
        to: [to],
        subject: `ממתין לטיפולך — ${d.summary ?? "פריטים פתוחים"}`,
        html: digestEmailHtml(n, name),
        text: `ממתין לטיפולך: ${d.summary ?? ""}. לטיפול: ${SITE}/admin?tab=${d.tab ?? "claims"}`,
      }),
    });
    if (!res.ok) { console.log("digest email failed", res.status, (await res.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) {
    console.log("digest email threw", (e as Error)?.message ?? String(e));
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (req.headers.get("x-push-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let n: NotificationRow;
  try {
    const payload = await req.json();
    // pg_net sends the trigger body; Supabase DB webhooks would nest under `record`.
    n = payload.record ?? payload.notification ?? payload;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!n?.user_id || !n?.type) return new Response("missing fields", { status: 400 });

  // סטופר מרקט is a game played for play money. A coin grant or a settled market is
  // worth a line in the bell, but it is not worth buzzing someone's phone — and three
  // of them landed on two people in one evening. Market events keep their bell row and
  // never become a push.
  if (n.type.startsWith("market")) {
    await logDeliveries(n, [{ platform: "none", status: "skipped", detail: "market" }]);
    return new Response(JSON.stringify({ sent: 0, skipped: "market" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  // Resolve the actor's display name (post_like/post_comment read it), matching the bell.
  let actorName = "מישהו";
  if (n.actor_id) {
    const { data: prof } = await admin
      .from("profiles").select("display_name").eq("id", n.actor_id).maybeSingle();
    if (prof?.display_name?.trim()) actorName = prof.display_name.trim();
  }

  const title = notificationText(n, actorName);
  const body = bodyPreview(n);
  const path = notificationHref(n);
  // Where on that page to land. A separate key, NOT a `#fragment` on `url`: apps that
  // predate it read url's second segment as the row id, and "<id>#game-form" would
  // never match (see notificationHref). New apps append it as `#<section>`.
  const section = n.type === "game_form_sign" ? "game-form"
    : n.type === "stream_approved" ? "broadcast"
    : null;

  // Recipient's devices.
  //
  // `data.platforms` narrows the fan-out to specific platforms — e.g. an
  // "update your app" nudge is only true for Android, where the app is sideloaded and
  // has no store to update it; pushing that to an iPhone would be nonsense. Absent (the
  // normal case) means every device, so existing notifications are unaffected.
  //
  // `data.max_app_version` narrows further to devices running a build at or below that
  // number — devices that never reported a version are INCLUDED, since an unknown build
  // is far more likely to be an old one than a new one.
  const wantPlatforms: string[] | null = Array.isArray(n.data?.platforms) && n.data.platforms.length
    ? n.data.platforms.map((p: unknown) => String(p))
    : null;
  const maxAppVersion: number | null = Number.isFinite(Number(n.data?.max_app_version))
    ? Number(n.data.max_app_version)
    : null;

  let subsQuery = admin
    .from("push_subscriptions")
    .select("id, platform, endpoint, keys, environment, app_version, app_version_name, user_agent")
    .eq("user_id", n.user_id);
  if (wantPlatforms) subsQuery = subsQuery.in("platform", wantPlatforms);
  if (maxAppVersion !== null) {
    subsQuery = subsQuery.or(`app_version.is.null,app_version.lte.${maxAppVersion}`);
  }
  const { data: subs, error } = await subsQuery;
  if (error) {
    console.log("subs query error", error.message);
    return new Response("db error", { status: 500 });
  }
  if (!subs?.length) {
    // nothing to push to — the digest is the one notification that still has to land
    const emailed = await emailDigestFallback(admin, n);
    await logDeliveries(n, [
      { platform: "none", status: "no_device", detail: wantPlatforms ? `platforms=${wantPlatforms.join(",")}` : null },
      ...(emailed ? [{ platform: "email", status: "emailed" }] : []),
    ]);
    return new Response(JSON.stringify({ sent: 0, emailed }), { status: 200 });
  }

  // Unread badge count for iOS.
  const { count: badge } = await admin
    .from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", n.user_id).is("read_at", null);

  const toPrune: string[] = [];
  const log: Delivery[] = [];
  let sent = 0;

  // Sign-up pushes carry מגיע / לא מגיע buttons. iOS: any build (old ones ignore the
  // category). Android: only builds that draw data-only sign-up pushes themselves —
  // an older one would receive a data-only message and show nothing.
  const availabilityGameId = AVAILABILITY_TYPES.has(n.type) && n.entity_id ? n.entity_id : null;
  const androidDrawsButtons = (s: PushSub) =>
    s.app_version != null && s.app_version >= AVAILABILITY_ACTIONS_MIN_ANDROID;

  await Promise.all((subs as PushSub[]).map(async (s) => {
    const dev = { subscription_id: s.id, platform: s.platform, app_version_name: s.app_version_name, user_agent: s.user_agent };
    const record = (ok: boolean, prune: boolean, detail?: string | null) =>
      log.push({ ...dev, status: ok ? "sent" : prune ? "pruned" : "failed", detail: detail ?? null });
    try {
      if (s.platform === "web") {
        if (!s.keys) { toPrune.push(s.id); record(false, true, "no keys"); return; }
        const webPayload = JSON.stringify({ title, body, url: path, tag: n.type });
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          webPayload,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
        record(true, false);
      } else if (s.platform === "ios") {
        const r = await sendApns(s.endpoint, s.environment, title, body, path, badge ?? 0, section,
          availabilityGameId);
        if (r.ok) sent++;
        if (r.prune) toPrune.push(s.id);
        record(r.ok, r.prune, r.detail);
      } else if (s.platform === "android") {
        if (!FCM_CONFIGURED) { log.push({ ...dev, status: "skipped", detail: "FCM not configured" }); return; }
        const r = await sendFcm(s.endpoint, title, body, path, section,
          androidDrawsButtons(s) ? availabilityGameId : null);
        if (r.ok) sent++;
        if (r.prune) toPrune.push(s.id);
        record(r.ok, r.prune, r.detail);
      }
    } catch (e: any) {
      const code = e?.statusCode ?? e?.status;
      const gone = code === 404 || code === 410;
      if (gone) toPrune.push(s.id); // gone/expired web sub
      record(false, gone, `${code ?? ""} ${e?.message ?? String(e)}`.trim().slice(0, 200));
      console.log(`push ${s.platform} err`, code ?? "", e?.message ?? String(e));
    }
  }));

  if (toPrune.length) {
    await admin.from("push_subscriptions").delete().in("id", toPrune);
  }

  // every device failed (all pruned, or all errored) — same reasoning as above
  const emailed = sent === 0 ? await emailDigestFallback(admin, n) : false;
  if (emailed) log.push({ platform: "email", status: "emailed" });
  await logDeliveries(n, log);

  return new Response(JSON.stringify({ sent, pruned: toPrune.length, emailed }), {
    status: 200, headers: { "content-type": "application/json" },
  });
});
