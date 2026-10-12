import { supabase } from './supabase'

/**
 * Loan invites (supabase/loan-requests.sql).
 *
 * A coach who is short picks from loanCandidates() — every player in the league with the
 * reason he can or cannot be borrowed for this game — and invites one. The PLAYER accepts
 * or declines; only an accepted invite puts him in the squad. A team borrows only up to
 * five field players (own sign-ups + loans); one goalkeeper may be borrowed on top. When
 * the team's own field players reach five, the server removes the loan accepted last.
 *
 * A player with no account cannot answer, so for him the coach still adds directly
 * (addPlayerToSquad), under the same cap.
 */

export const LOAN_FIELD_TARGET = 5

/** Why a player can't be borrowed — short chip text for the list. */
export const LOAN_BLOCK_LABEL = {
  own_player:      'שחקן הקבוצה',
  opponent:        'בקבוצה היריבה',
  in_squad:        'כבר בסגל',
  too_old:         'מעל גיל 18',
  suspended:       'מורחק',
  unavailable:     'בהיעדרות',
  no_medical:      'אין אישור רפואי',
  busy:            'משחק באותו זמן',
  squad_full:      'יש כבר 5 שחקני שדה',
  gk_full:         'כבר הושאל שוער',
  no_account:      'אין לו חשבון',
  already_invited: 'כבר הוזמן',
  no_dob:          'אין תאריך לידה',
  no_call:         'הקבוצה כבר לא מחפשת',
  test_mismatch:   'קבוצת בדיקה 🧪',
}

/** The same reasons as full sentences, for a refusal. */
const LOAN_BLOCK_MSG = {
  own_player:      'השחקן כבר בקבוצה שלך — אין צורך בהשאלה',
  opponent:        'אי אפשר להשאיל שחקן מהקבוצה היריבה',
  in_squad:        'השחקן כבר רשום למשחק הזה',
  too_old:         'אפשר להשאיל רק שחקן/ית עד גיל 18, או שוער/ת בכל גיל',
  suspended:       'השחקן מורחק בגלל כרטיס אדום',
  unavailable:     'לשחקן יש היעדרות מאושרת במועד המשחק',
  no_medical:      'לשחקן אין אישור רפואי בתוקף ביום המשחק',
  busy:            'השחקן כבר משחק במשחק אחר באותו זמן',
  squad_full:      `יש כבר ${LOAN_FIELD_TARGET} שחקני שדה בסגל — אי אפשר להשאיל עוד`,
  gk_full:         'כבר הושאל שוער למשחק הזה',
  no_account:      'לשחקן אין חשבון באפליקציה, ולכן אי אפשר לשלוח לו הזמנה — אפשר להוסיף אותו ישירות',
  already_invited: 'כבר יש בקשה פתוחה למשחק הזה',
  no_dob:          'כדי להצטרף צריך תאריך לידה בכרטיס השחקן — אפשר להוסיף אותו באזור האישי',
  no_call:         'הקבוצה כבר לא מחפשת שחקן בתפקיד שלך למשחק הזה',
  test_mismatch:   'שחקני קבוצות הבדיקה 🧪 לא משחקים במשחקי הליגה (ולהפך)',
}

const LOAN_ERRORS = {
  'game already started': 'המשחק כבר התחיל',
  'not authorized':       'אין לך הרשאה לפעולה הזו',
  'request closed':       'ההזמנה כבר לא פתוחה',
  'request not found':    'ההזמנה לא נמצאה',
  'team not in this game': 'הקבוצה אינה משתתפת במשחק זה',
}

export function loanError(e) {
  const msg = String(e?.message || '')
  const block = msg.match(/loan_block:(\w+)/)
  if (block) return new Error(LOAN_BLOCK_MSG[block[1]] || 'אי אפשר להשאיל את השחקן')
  for (const [key, he] of Object.entries(LOAN_ERRORS)) if (msg.includes(key)) return new Error(he)
  return new Error('הפעולה נכשלה, נסו שוב')
}

/** Everyone in the league who is not on this team, with `block` = why not (null = can). */
export async function getLoanCandidates(gameId, teamId) {
  const { data, error } = await supabase.rpc('loan_candidates', { p_game_id: gameId, p_team_id: teamId })
  if (error) throw loanError(error)
  return data || []
}

/** { own_field, loan_field, loan_gk, field_slots, gk_slots, open, requests[] } */
export async function getLoanSummary(gameId, teamId) {
  const { data, error } = await supabase.rpc('loan_summary', { p_game_id: gameId, p_team_id: teamId })
  if (error) throw loanError(error)
  return data
}

export async function requestLoan(gameId, teamId, playerId, note = null) {
  const { data, error } = await supabase.rpc('request_loan', {
    p_game_id: gameId, p_team_id: teamId, p_player_id: playerId, p_note: note || null,
  })
  if (error) throw loanError(error)
  return data
}

export async function cancelLoan(requestId) {
  const { error } = await supabase.rpc('cancel_loan', { p_request_id: requestId })
  if (error) throw loanError(error)
}

/** The signed-in player's open invites (pending or accepted) for games not yet played. */
export async function getMyLoanRequests() {
  const { data, error } = await supabase.rpc('my_loan_requests')
  if (error) return []
  return data || []
}

/** → 'accepted' | 'declined' | 'filled' (the squad filled up before he answered). */
export async function respondLoan(requestId, accept) {
  const { data, error } = await supabase.rpc('respond_loan', { p_request_id: requestId, p_accept: !!accept })
  if (error) throw loanError(error)
  return data
}

// ── loan calls + the youth loan page (supabase/loan-calls.sql) ─────────────────────

/** { player_id, position, age, eligible, reason: null|'no_dob'|'too_old'|'no_player', viewer } */
export async function getMyLoanEligibility() {
  const { data, error } = await supabase.rpc('my_loan_eligibility')
  if (error) return null
  return data
}

/** The coach raises (or lowers) his team's hand for a game. */
export async function setLoanCall(gameId, teamId, { needField, needGk, note = null }) {
  const { error } = await supabase.rpc('set_loan_call', {
    p_game_id: gameId, p_team_id: teamId, p_need_field: !!needField, p_need_gk: !!needGk, p_note: note || null,
  })
  if (error) throw loanError(error)
}

/** Every open call that still has room, with the caller's own standing for each. */
export async function getLoanBoard() {
  const { data, error } = await supabase.rpc('loan_board')
  if (error) throw loanError(error)
  return data || []
}

export async function askToJoinLoan(gameId, teamId, note = null) {
  const { data, error } = await supabase.rpc('ask_to_join_loan', {
    p_game_id: gameId, p_team_id: teamId, p_note: note || null,
  })
  if (error) throw loanError(error)
  return data
}

/** The coach answers a player's ask → 'accepted' | 'declined' | 'filled'. */
export async function respondLoanJoin(requestId, accept) {
  const { data, error } = await supabase.rpc('respond_loan_join', { p_request_id: requestId, p_accept: !!accept })
  if (error) throw loanError(error)
  return data
}

/**
 * Goals each player scored ON LOAN this season → { [playerId]: { goals, games } }.
 * players.goals includes them (they are his goals); the team page subtracts them to show
 * what he scored for his own team. Same game filter as the season total.
 */
export async function getPlayerLoanGoals(playerIds) {
  const ids = (playerIds || []).filter(Boolean)
  if (!ids.length) return {}
  const { data, error } = await supabase.rpc('player_loan_goals', { p_player_ids: ids })
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.player_id, { goals: r.loan_goals, games: r.loan_games }]))
}
