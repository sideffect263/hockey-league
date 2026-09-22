import { supabase } from './supabase'
import { ROLE_LABEL } from './roles'

/**
 * In-app notifications ("bell"). Rows are written server-side only (SECURITY
 * DEFINER triggers — see supabase/notifications-schema.sql); the client just
 * reads / marks-read / dismisses its own. Actor profiles are resolved with a
 * separate lookup (never a PostgREST embed — see the embed-ambiguity gotcha).
 *
 * Queries mirror the RLS predicate (`user_id = auth.uid()`) explicitly rather
 * than leaning on it silently.
 */

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id || null
}

export async function getNotifications(limit = 30) {
  const me = await currentUserId()
  if (!me) return []
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = data || []

  const actorIds = [...new Set(rows.map(r => r.actor_id).filter(Boolean))]
  let profiles = {}
  if (actorIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, player_id')
      .in('id', actorIds)
    profiles = Object.fromEntries((profs || []).map(p => [p.id, p]))
  }
  return rows.map(r => ({ ...r, actor: r.actor_id ? profiles[r.actor_id] || null : null }))
}

export async function getUnreadCount() {
  const me = await currentUserId()
  if (!me) return 0
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', me)
    .is('read_at', null)
  if (error) return 0
  return count || 0
}

export async function markAllRead() {
  const me = await currentUserId()
  if (!me) return
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', me)
    .is('read_at', null)
  if (error) throw error
}

export async function markRead(id) {
  const me = await currentUserId()
  if (!me) return
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', me)
  if (error) throw error
}

// Live badge: invoke cb on every new notification for this user. Returns an
// unsubscribe fn. No-op-safe if Realtime isn't reachable (the bell also
// refreshes on window focus as a fallback).
export function subscribeToNotifications(userId, cb) {
  if (!userId) return () => {}
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => cb(payload.new),
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ---- presentation --------------------------------------------------------

const actorName = (n) => n.actor?.display_name?.trim() || 'מישהו'

// "בית נגד חוץ" for the scheduled game reminders.
const vs = (d) => `${d.home_team || ''} נגד ${d.away_team || ''}`.trim()

// F1 — player availability constraints. The kind is stored as a stable English token so
// the DB and the native clients agree on it; only the label is Hebrew.
const UNAVAILABILITY_KIND = {
  injury: 'פציעה', abroad: 'שהות בחו״ל', reserve_duty: 'מילואים', other: 'סיבה אחרת',
}
const kindLabel = (k) => UNAVAILABILITY_KIND[k] || 'אי-זמינות'
// Dates read LTR inside an RTL sentence, so keep each run whole (RTL bidi gotcha).
const day = (v) => (v ? new Date(v).toLocaleDateString('he-IL') : '')
const span = (d) => (d.ends_on ? `${day(d.starts_on)}–${day(d.ends_on)}` : `מ־${day(d.starts_on)}`)

// What actually changed about the fixture. Leads with the NEW value — that is the thing
// the reader has to act on; the old one is only there to make the change legible.
function movedSummary(d) {
  const when = d.game_date
    ? new Date(d.game_date).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
  if (d.what === 'venue') return `המשחק עבר ל${d.venue || 'מגרש אחר'}`
  if (d.what === 'time')  return `המשחק נדחה ל־${when}`
  return `המשחק עבר ל${d.venue || 'מגרש אחר'} ונדחה ל־${when}`
}

// The officials digest is only useful if it leads with what's MISSING — that is the
// whole point of sending it on Tuesday and again on Thursday.
function officialsSummary(d) {
  const missing = []
  if (!(d.judges > 0)) missing.push('שופט')
  if (!(d.medics > 0)) missing.push('חובש')
  return missing.length ? `חסר ${missing.join(' ו')}` : 'שופט וחובש משובצים ✅'
}

// Hebrew one-liner for a notification row.
export function notificationText(n) {
  const d = n.data || {}
  switch (n.type) {
    case 'post_like':      return `${actorName(n)} אהב/ה את הפוסט שלך`
    case 'post_comment':   return `${actorName(n)} הגיב/ה על הפוסט שלך`
    case 'claim_approved': return `הבקשה שלך להתחבר לשחקן ${d.player_name || ''} אושרה 🎉`
    case 'claim_rejected': return `הבקשה שלך להתחבר לשחקן ${d.player_name || ''} נדחתה`
    case 'role_granted':   return `קיבלת תפקיד: ${ROLE_LABEL[d.role] || d.role || ''}`
    case 'claim_request':  return `${d.claimant || 'משתמש'} מבקש/ת להתחבר לשחקן ${d.player_name || ''}`
    case 'content_report': return `דווח תוכן${d.reason ? ` — ${d.reason}` : ''}`
    case 'game_result':    return `תוצאה: ${d.home_team || ''} ${d.away_score ?? ''}:${d.home_score ?? ''} ${d.away_team || ''}`
    case 'game_change_request':  return `${actorName(n)} מבקש/ת שינוי במשחק ${d.home_team || ''} נגד ${d.away_team || ''}${d.reason ? ` — ${d.reason}` : ''}`
    case 'game_change_opponent': return `${actorName(n)} מבקש/ת שינוי מועד — יש לבחור מועד שמתאים לך${d.reason ? ` (${d.reason})` : ''}`
    case 'game_change_approved': return `בקשתך לשינוי המשחק ${d.home_team || ''} נגד ${d.away_team || ''} אושרה 🎉${d.decision_note ? ` — ${d.decision_note}` : ''}`
    case 'game_change_rejected': return `בקשתך לשינוי המשחק ${d.home_team || ''} נגד ${d.away_team || ''} נדחתה${d.decision_note ? ` — ${d.decision_note}` : ''}`
    case 'team_join_request':    return `${actorName(n)} מבקש/ת להצטרף לקבוצת ${d.team_name || ''}`
    case 'team_join_approved':   return `בקשתך להצטרף לקבוצת ${d.team_name || ''} אושרה 🎉`
    case 'team_join_rejected':   return `בקשתך להצטרף לקבוצת ${d.team_name || ''} נדחתה`
    case 'coach_request':          return `${d.requester || actorName(n)} מבקש/ת להיות מאמן/ת של ${d.team_name || 'קבוצה'}`
    case 'coach_request_rejected': return `בקשתך להיות מאמן/ת של ${d.team_name || 'קבוצה'} נדחתה`
    case 'player_submission_request':  return `${actorName(n)} הגיש/ה כרטיס שחקן חדש${d.candidate_name ? `: ${d.candidate_name}` : ''}${d.team_name ? ` — ${d.team_name}` : ''}`
    case 'player_submission_approved': return `כרטיס השחקן ${d.candidate_name || ''} שהגשת אושר 🎉`
    // P6 row 30 — a rejection without its reason is a dead end for the submitter
    case 'player_submission_rejected': return `כרטיס השחקן ${d.candidate_name || ''} נדחה${d.reason ? ` — ${d.reason}` : ''}`
    case 'medical_submitted':    return `${d.player_name || actorName(n)} העלה/תה אישור רפואי הממתין לאישור`
    // Stage 2 — the coach signed off, the league manager still has to verify the player
    // is registered in פודיום before he may play.
    case 'medical_pending_manager': return `${d.player_name || 'שחקן'}${d.team_name ? ` (${d.team_name})` : ''} — המאמן אישר את הבדיקה, ממתין לאימות רישום בפודיום`
    case 'medical_coach_approved':  return `המאמן אישר את הבדיקה הרפואית שלך — ממתין לאישור המנהלת`
    case 'medical_approved':     return `האישור הרפואי שלך אושר ✅`
    case 'medical_rejected':     return `האישור הרפואי שלך נדחה — יש להעלות מחדש`
    case 'medical_expiring':     return `האישור הרפואי שלך יפוג בעוד ${d.days_left ?? ''} ימים — מומלץ לחדש`
    // P6 row 27 — the coach gets it too; many players have no account to receive it
    case 'medical_expiring_player': return `האישור הרפואי של ${d.player_name || 'שחקן'} יפוג בעוד ${d.days_left ?? ''} ימים`
    // The manager reviewed the file himself and rejected it — losing a valid
    // medical means no registering, so the reason has to travel with it.
    // F1 — an absence a player reported for himself, waiting on his coach
    // the daily 19:00 chase — one line naming every queue still waiting on this coach
    case 'coach_open_items': return `ממתין לטיפולך: ${d.summary || ''}${d.oldest_days > 0 ? ` — הוותיק ביותר כבר ${d.oldest_days} ימים` : ''}`
    case 'unavailability_reported': return `${d.player_name || actorName(n)} דיווח/ה על אי-זמינות (${kindLabel(d.kind)}) ${span(d)} — ממתין לאישורך`
    case 'unavailability_approved': return `דיווח אי-הזמינות שלך (${kindLabel(d.kind)}) ${span(d)} אושר ✅${d.decision_note ? ` — ${d.decision_note}` : ''}`
    case 'unavailability_rejected': return `דיווח אי-הזמינות שלך (${kindLabel(d.kind)}) ${span(d)} נדחה${d.decision_note ? ` — ${d.decision_note}` : ''}`
    case 'medical_revoked':      return `האישור הרפואי ${d.player_name ? `של ${d.player_name} ` : ''}בוטל${d.reason ? ` — ${d.reason}` : ''}`
    case 'medical_date_changed': return `תאריך הבדיקה עודכן — האישור בתוקף עד ${d.expires_at ? new Date(d.expires_at).toLocaleDateString('he-IL') : ''}`
    case 'tournament_invite':          return `קבוצת ${d.team_name || ''} הוזמנה לטורניר ${d.tournament_name || ''}`
    case 'tournament_invite_accepted': return `קבוצת ${d.team_name || ''} אישרה השתתפות בטורניר ${d.tournament_name || ''} 🎉`
    case 'tournament_invite_declined': return `קבוצת ${d.team_name || ''} דחתה את ההזמנה לטורניר ${d.tournament_name || ''}`
    // Scheduled game reminders (P2). `vs` keeps the two team names in a fixed order so
    // the sentence reads the same regardless of which side is home.
    case 'game_register_reminder': return `משחק מתקרב: ${vs(d)} — נא לסמן הגעה`
    case 'game_register_nudge':    return `עדיין לא סימנת הגעה למשחק ${vs(d)}`
    case 'coach_squad_digest':     return `סגל למשחק ${vs(d)}: ${d.yes ?? 0} מגיעים, ${d.no ?? 0} לא מגיעים, ${d.pending ?? 0} טרם הגיבו`
    case 'lm_squad_digest':        return `סגלים למשחק ${vs(d)}: ${d.home_team || 'בית'} ${d.home_count ?? 0}, ${d.away_team || 'חוץ'} ${d.away_count ?? 0}`
    case 'lm_officials_digest':    return `${vs(d)} — ${officialsSummary(d)}`
    // P4 — the league manager's own words come first; the fixture is context
    case 'lm_broadcast':           return `הודעת מנהל הליגה (${vs(d)}): ${d.message || ''}`
    case 'game_moved':             return `${vs(d)} — ${movedSummary(d)}`
    // P5 — you follow one of these teams and asked to be told
    case 'follow_game_alert':      return `מחר: ${vs(d)}`
    // P5 — a goal in a game you follow. Score reads away:home, per the RTL gotcha.
    case 'app_update':             return `גרסה חדשה של האפליקציה זמינה${d.version_name ? ` (${d.version_name})` : ''} — הורידו מהאתר`
    case 'goal_scored':            return `⚽ ${d.scoring_team || ''} הבקיעה! ${vs(d)} ${d.away_score ?? ''}:${d.home_score ?? ''}`
    case 'official_assigned':              return `שובצת כ${ROLE_LABEL[d.role] || 'בעל תפקיד'} למשחק`
    case 'official_application':           return `${actorName(n)} הגיש/ה מועמדות כ${ROLE_LABEL[d.role] || 'בעל תפקיד'}`
    case 'official_application_approved':  return `מועמדותך לשיבוץ כ${ROLE_LABEL[d.role] || 'בעל תפקיד'} אושרה 🎉`
    case 'official_application_rejected':  return `מועמדותך לשיבוץ כ${ROLE_LABEL[d.role] || 'בעל תפקיד'} נדחתה`
    // הוקי מרקט. `won` is 0 for a holder who backed a losing outcome — say so
    // rather than announcing a payout of nothing.
    case 'market_resolved':
      return Number(d.won) > 0
        ? `${d.title || 'שוק'} הוכרע: ${d.outcome || ''} — זכית ב-${Math.round(Number(d.won))} מטבעות 🎉`
        : `${d.title || 'שוק'} הוכרע: ${d.outcome || ''} — הפעם לא הצלחת`
    case 'market_coins':
      return Number(d.delta) >= 0
        ? `קיבלת ${Math.round(Number(d.delta))} מטבעות להוקי מרקט${d.reason ? ` — ${d.reason}` : ''}`
        : `הופחתו ${Math.abs(Math.round(Number(d.delta)))} מטבעות מהחשבון בהוקי מרקט${d.reason ? ` — ${d.reason}` : ''}`
    default:               return 'התראה חדשה'
  }
}

// Emoji glyph per type (the bell keeps the actor avatar when there is one).
export function notificationIcon(n) {
  switch (n.type) {
    case 'post_like':      return '❤️'
    case 'post_comment':   return '💬'
    case 'claim_approved': return '✅'
    case 'claim_rejected': return '⛔'
    case 'role_granted':   return '🎖️'
    case 'claim_request':  return '🙋'
    case 'content_report': return '🚩'
    case 'game_result':    return '⚽'
    case 'game_change_request':  return '🗓️'
    case 'game_change_opponent': return '🗓️'
    case 'game_change_approved': return '✅'
    case 'game_change_rejected': return '⛔'
    case 'team_join_request':    return '🤝'
    case 'team_join_approved':   return '✅'
    case 'team_join_rejected':   return '⛔'
    case 'coach_request':          return '🧑‍🏫'
    case 'coach_request_rejected': return '⛔'
    case 'player_submission_request':  return '🆕'
    case 'player_submission_approved': return '✅'
    case 'player_submission_rejected': return '⛔'
    case 'medical_submitted':    return '🩺'
    case 'medical_pending_manager': return '🩺'
    case 'medical_coach_approved':  return '⏳'
    case 'medical_approved':     return '🩺'
    case 'medical_rejected':     return '⛔'
    case 'medical_expiring':     return '⏰'
    case 'coach_open_items':        return '📋'
    case 'unavailability_reported': return '🚑'
    case 'unavailability_approved': return '✅'
    case 'unavailability_rejected': return '⛔'
    case 'medical_revoked':      return '⛔'
    case 'medical_date_changed': return '🩺'
    case 'medical_expiring_player': return '⏰'
    case 'tournament_invite':          return '🏆'
    case 'tournament_invite_accepted': return '✅'
    case 'tournament_invite_declined': return '⛔'
    case 'game_register_reminder': return '📣'
    case 'game_register_nudge':    return '⏰'
    case 'coach_squad_digest':     return '📋'
    case 'lm_squad_digest':        return '📋'
    case 'lm_officials_digest':    return '⚖️'
    case 'lm_broadcast':           return '📢'
    case 'game_moved':             return '🌧️'
    case 'follow_game_alert':      return '⭐'
    case 'app_update':             return '⬇️'
    case 'goal_scored':            return '⚽'
    case 'official_assigned':              return '⚖️'
    case 'official_application':           return '📝'
    case 'official_application_approved':  return '✅'
    case 'official_application_rejected':  return '⛔'
    case 'market_resolved': return '📈'
    case 'market_coins':    return '🪙'
    default:               return '🔔'
  }
}

// Where clicking the notification takes you.
//
// Deliberately still the UUID form. `entity_id` is what the row stores — for
// rows written months ago as much as for ones written a second ago — and the
// UUID route resolves everywhere: in-app useSlugId passes it straight through,
// and a cold load gets a 308 to the slug from api/resolve.js. Translating here
// would mean a slug lookup per notification in the bell, for no gain.
export function notificationHref(n) {
  switch (n.type) {
    case 'claim_approved':
    case 'claim_rejected': return n.entity_id ? `/players/${n.entity_id}` : '/me'
    case 'role_granted':   return '/me'
    // Deep-link to the TAB the notification is about. Bare /admin opens whatever tab
    // happens to be first, leaving the reviewer to hunt for the queue in question.
    case 'claim_request':          return '/admin?tab=claims'
    case 'content_report':         return '/admin?tab=reports'
    case 'game_change_request':    return '/admin?tab=game_requests'
    case 'game_change_opponent':
    case 'game_result':
    case 'game_change_approved':
    case 'game_change_rejected':
    // every scheduled reminder is about one game, and the action (סימון הגעה,
    // reviewing the squad) lives on that game's page
    case 'game_register_reminder':
    case 'game_register_nudge':
    case 'coach_squad_digest':
    case 'lm_squad_digest':
    case 'lm_officials_digest':
    case 'lm_broadcast':
    case 'game_moved':
    case 'follow_game_alert':      return n.entity_id ? `/games/${n.entity_id}` : '/games'
    case 'app_update':            return '/app'
    case 'goal_scored':           return n.entity_id ? `/games/${n.entity_id}` : '/games'
    // reviewers land on the /admin review tabs
    case 'team_join_request':
    case 'player_submission_request':
    case 'medical_submitted':      return '/admin?tab=claims'
    case 'medical_pending_manager': return '/admin?tab=medical'
    // the player / submitter lands where the outcome lives
    case 'team_join_approved':
    case 'team_join_rejected':     return n.entity_id ? `/teams/${n.entity_id}` : '/me'
    case 'coach_request':          return '/admin?tab=claims'
    case 'coach_request_rejected': return n.entity_id ? `/teams/${n.entity_id}` : '/me'
    case 'player_submission_approved': return n.data?.player_id ? `/players/${n.data.player_id}` : '/me'
    case 'player_submission_rejected':
    case 'medical_approved':
    case 'medical_rejected':
    case 'medical_coach_approved':
    case 'medical_expiring':       return '/me'
    case 'medical_expiring_player': return '/admin?tab=claims'
    // F1 — the reviewer lands on the player whose absence it is; the player on his own page
    // the recipient is the coach the report is waiting on — land him on the queue
    case 'coach_open_items': return `/admin?tab=${n.entity_id || 'claims'}`
    case 'unavailability_reported': return '/admin?tab=unavailability'
    case 'unavailability_approved':
    case 'unavailability_rejected': return '/me'
    case 'medical_revoked':
    case 'medical_date_changed':   return '/me'
    case 'tournament_invite':
    case 'tournament_invite_accepted':
    case 'tournament_invite_declined': return n.entity_id ? `/tournaments/${n.entity_id}` : '/tournaments'
    case 'official_assigned':
    case 'official_application_approved':
    case 'official_application_rejected': return n.entity_id ? `/games/${n.entity_id}` : '/games'
    case 'official_application':   return '/admin?tab=officials'
    case 'market_resolved':        return n.entity_id ? `/market/${n.entity_id}` : '/market'
    case 'market_coins':           return '/market'
    // Land on the post itself. The feed paginates, so an old post may not be mounted —
    // the anchor simply does nothing then and you get the feed, which is no worse than
    // today's behaviour.
    case 'post_like':
    case 'post_comment':   return n.entity_id ? `/#post-${n.entity_id}` : '/'
    default:               return '/'
  }
}
