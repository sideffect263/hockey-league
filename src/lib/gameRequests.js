import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * Coach-requested game reschedules with DUAL approval (#2/#5): the coach proposes up
 * to a few dates + a venue; the OPPONENT team's coach picks the workable date(s) (or
 * rejects); then a league-manager finalizes one date and it's applied. If the opponent
 * team has no coach, it skips straight to the manager. Every write is a SECURITY
 * DEFINER RPC (supabase/game-change-*.sql); reads are RLS-scoped to both teams'
 * coaches + managers/admins.
 */

function requestError(e) {
  const code = e?.code
  const msg = String(e?.message || '')
  if (code === '23505' || /one_open_per_game|one_pending_per_game|duplicate key/i.test(msg))
    return new Error('כבר קיימת בקשת שינוי פתוחה למשחק זה')
  if (/only a coach/i.test(msg))            return new Error('רק מאמן של אחת הקבוצות יכול לבקש שינוי')
  if (/scheduled or postponed/i.test(msg))  return new Error('אפשר לבקש שינוי רק למשחק מתוכנן או שנדחה')
  if (/reason is required/i.test(msg))      return new Error('יש להזין סיבה לבקשה')
  if (/propose a new/i.test(msg))           return new Error('יש להציע תאריך/שעה או מגרש חדשים')
  if (/choose a date|not among the agreed/i.test(msg)) return new Error('יש לבחור אחד מהתאריכים שסוכמו')
  if (/not authorized/i.test(msg))          return new Error('אין לך הרשאה לפעולה זו')
  if (/not found/i.test(msg))               return new Error('הבקשה לא נמצאה או כבר טופלה')
  return e instanceof Error ? e : new Error(msg || 'שגיאה')
}

// Coach submits: dates = array of ISO strings (0..N), venue = string|null, reason.
export async function requestGameChange(gameId, { dates, venue, reason }) {
  const { error } = await supabase.rpc('request_game_change', {
    p_game_id: gameId,
    p_dates: dates && dates.length ? dates : null,
    p_venue: venue || null,
    p_reason: reason || null,
  })
  if (error) throw requestError(error)
}

// Opponent coach: agree to a subset of dates (→ manager) or reject.
export async function respondGameChangeOpponent(id, agreeDates, approve) {
  const { error } = await supabase.rpc('respond_game_change_opponent', {
    p_id: id, p_agree_dates: agreeDates || [], p_approve: approve,
  })
  if (error) throw requestError(error)
}

// League-manager/admin: pick one agreed date and apply it (+ venue) to the game.
export async function finalizeGameChange(id, chosenDate) {
  const { error } = await supabase.rpc('finalize_game_change', { p_id: id, p_chosen_date: chosenDate || null })
  if (error) throw requestError(error)
}

export async function rejectGameChange(id, note = null) {
  const { error } = await supabase.rpc('reject_game_change', { p_id: id, p_note: note || null })
  if (error) throw requestError(error)
}

export async function cancelGameChangeRequest(id) {
  const { error } = await supabase.rpc('cancel_game_change_request', { p_id: id })
  if (error) throw requestError(error)
}

// The current user's own latest request for a game (any status), or null.
export async function getMyGameChangeRequest(gameId) {
  const user = await sessionUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('game_change_requests').select('*')
    .eq('game_id', gameId).eq('requested_by', user.id)
    .order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  return data?.[0] || null
}

// The current OPEN request for a game (for the opponent-coach response card), or null.
export async function getOpenGameChangeRequest(gameId) {
  const { data, error } = await supabase
    .from('game_change_requests').select('*')
    .eq('game_id', gameId).in('status', ['pending_opponent', 'pending_manager'])
    .order('created_at', { ascending: false }).limit(1)
  if (error) return null
  return data?.[0] || null
}

// Manager/admin queue: requests awaiting FINALIZATION (opponent already agreed, or no
// opponent coach), + the game and requester.
export async function getPendingGameChangeRequests() {
  const { data, error } = await supabase
    .from('game_change_requests')
    .select(
      '*, games(id, game_date, venue, status, home_team_id, away_team_id), ' +
      'requester:profiles!game_change_requests_requested_by_fkey(id, display_name, avatar_url)'
    )
    .eq('status', 'pending_manager')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Coach's feed card ("מחכה לך"): requests on his team's games that wait for HIS answer —
// the opponent asked, status pending_opponent. Additive (Floodlight feed, 2026-10-31).
export async function getOpponentGameChangeRequests(teamIds = []) {
  if (!teamIds.length) return []
  const user = await sessionUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('game_change_requests')
    .select('id, game_id, status, requested_by, created_at, games(id, game_date, home_team_id, away_team_id)')
    .eq('status', 'pending_opponent')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).filter(r => r.requested_by !== user.id && r.games
    && (teamIds.includes(r.games.home_team_id) || teamIds.includes(r.games.away_team_id)))
}

export const GC_STATUS = {
  pending:          { label: 'ממתינה לאישור',        cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  pending_opponent: { label: 'ממתינה לאישור המאמן היריב', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  pending_manager:  { label: 'ממתינה לאישור מנהל הליגה',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  approved:  { label: 'אושרה',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected:  { label: 'נדחתה',  cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  cancelled: { label: 'בוטלה',  cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400' },
}
