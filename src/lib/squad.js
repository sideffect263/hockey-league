import { supabase } from './supabase'
import { loanError } from './loans'

/**
 * Manual squad management (P1 — sheet rows 7, 8, 13, 14, 15, 33).
 *
 * A coach builds his squad before kick-off; once the game is running it is the judge's
 * sheet, so the judge (and admin / league manager) may add at any time. Every rule is
 * enforced server-side in add_player_to_squad — a valid medical, no active red-card
 * block, and the coach's age confirmation — so these helpers only translate the
 * refusals into something a coach can act on.
 *
 * Note the deliberate asymmetry with the judge's free-text guest on the scoresheet:
 * a manually added squad player must be a real player card, because the medical and
 * red-card checks have nothing to check against otherwise.
 */

export const SQUAD_ERRORS = {
  'no valid medical':     'לשחקן אין בדיקה רפואית מאושרת בתוקף',
  'suspended':            'השחקן מורחק בגלל כרטיס אדום ואינו יכול לשחק במשחק הבא',
  // add_player_to_squad and set_game_availability both raise this once an approved
  // absence covers the fixture's date — without it the coach just sees a generic failure.
  'unavailable':          'לשחקן יש היעדרות מאושרת במועד המשחק',
  'age not confirmed':    'יש לאשר שהשחקן/ית עומד/ת בדרישת הגיל להשאלה',
  'loan not youth':       'אפשר להשאיל רק שחקן/ית עד גיל 18, או שוער/ת בכל גיל',
  'team not in this game': 'הקבוצה אינה משתתפת במשחק זה',
  'game already started': 'המשחק כבר התחיל — רק שופט יכול להוסיף שחקן',
  'not authorized':       'אין לך הרשאה להוסיף שחקן למשחק זה',
  'player not found':     'השחקן לא נמצא',
  'game not found':       'המשחק לא נמצא',
  'not a manual entry':   'אפשר להסיר רק שחקן שנוסף ידנית',
  'not in this game':     'השחקן אינו שייך לאחת מהקבוצות במשחק',
  // A coach borrows a player who has an account by inviting him (LoanFinder); the
  // direct add is only for players who could not answer an invite.
  'loan needs invite':    'לשחקן יש חשבון — שלחו לו הזמנה דרך "חיפוש שחקן להשאלה", והוא יאשר בעצמו',
}

function squadError(e) {
  const msg = String(e?.message || '')
  if (msg.includes('loan_block:')) return loanError(e)
  for (const [key, he] of Object.entries(SQUAD_ERRORS)) {
    if (msg.includes(key)) return new Error(he)
  }
  return new Error('הפעולה נכשלה, נסו שוב')
}

/**
 * Add a player to a game's squad for a specific team.
 * `ageConfirmed` must be true — the coach vouches for eligibility, since the schema
 * holds no birth date to check "14 או כיתה ח" against.
 */
export async function addPlayerToSquad(gameId, playerId, teamId, { note = null, ageConfirmed = false } = {}) {
  const { error } = await supabase.rpc('add_player_to_squad', {
    p_game_id: gameId,
    p_player_id: playerId,
    p_team_id: teamId,
    p_note: note,
    p_age_confirmed: !!ageConfirmed,
  })
  if (error) throw squadError(error)
}

/** Remove a manually added player (never a player's own declaration). */
export async function removePlayerFromSquad(gameId, playerId) {
  const { error } = await supabase.rpc('remove_player_from_squad', {
    p_game_id: gameId, p_player_id: playerId,
  })
  if (error) throw squadError(error)
}

/**
 * The player's active red-card block, or null. Lets the UI disable the מגיע button with
 * a reason up front instead of letting him press it and get a refusal.
 */
export async function getActiveSuspension(playerId) {
  if (!playerId) return null
  const { data, error } = await supabase.rpc('active_suspension', { p_player: playerId })
  if (error) return null
  return (Array.isArray(data) ? data[0] : data) || null
}

/**
 * The active red-card blocks for a set of players, as playerId → row.
 *
 * A direct table read, not N× active_suspension(): the SELECT policy on
 * player_suspensions already admits a coach for his own players (through BOTH
 * players.team_id and player_teams), so one filtered query returns exactly the squad he
 * may see, and anyone else's row simply doesn't come back.
 *
 * Deliberately NOT active_suspensions() (plural) — that RPC gates on admin / league
 * manager / judge and raises 'not authorized' for the coach who needs this most.
 */
export async function getActiveSuspensionsFor(playerIds) {
  const ids = [...new Set((playerIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await supabase
    .from('player_suspensions')
    .select('id,player_id,reason,games_remaining')
    .in('player_id', ids)
    .is('cleared_at', null)
    .gt('games_remaining', 0)
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.player_id, r]))
}

/**
 * The player ids on a team's roster, from player_teams.
 *
 * The loan rule the server enforces asks "is he one of THIS team's own players?" against
 * players.team_id OR player_teams — so judging it by the primary team_id alone would call
 * a player on the team's own roster a loan, and demand an age confirmation for a teammate.
 * player_teams is world-readable, so this needs no privileges of its own.
 */
export async function getTeamMemberIds(teamId) {
  if (!teamId) return new Set()
  const { data, error } = await supabase
    .from('player_teams').select('player_id').eq('team_id', teamId)
  if (error) return new Set()
  return new Set((data || []).map(r => r.player_id))
}

/**
 * The full squad for a game: roster players who answered, plus manually added players.
 * The latter are on neither roster, so a players-by-team query cannot find them —
 * which is exactly why this goes through a definer RPC rather than a table read.
 * Returns [] for anyone not entitled to see it rather than throwing.
 */
export async function getGameSquad(gameId) {
  if (!gameId) return []
  const { data, error } = await supabase.rpc('game_squad', { p_game_id: gameId })
  if (error) return []
  return data || []
}
