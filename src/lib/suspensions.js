import { supabase } from './supabase'

/**
 * Red-card blocks (sheet rows 5 + 15).
 *
 * Deliberately NOT derived from the scoresheet: the card is issued by a person — the
 * judge as it happens, or the league manager afterwards — and blocks the player's next
 * game. Serving is automatic (a trigger burns one game when a game his team plays
 * completes), so nobody has to remember to lift it.
 */

export async function issueSuspension(playerId, { gameId = null, reason = null, games = 1 } = {}) {
  const { data, error } = await supabase.rpc('issue_suspension', {
    p_player: playerId, p_game: gameId, p_reason: reason, p_games: games,
  })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('אין לך הרשאה להרחיק שחקן')
    if (/player not found/i.test(error.message || '')) throw new Error('השחקן לא נמצא')
    throw new Error('ההרחקה נכשלה')
  }
  return data
}

/** Lift a block early — the card was given in error, or the manager decided otherwise. */
export async function clearSuspension(id) {
  const { error } = await supabase.rpc('clear_suspension', { p_id: id })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('אין לך הרשאה לבטל הרחקה')
    throw new Error('ביטול ההרחקה נכשל')
  }
}

/** Every block currently in force (admin / league manager / judge). */
export async function getActiveSuspensions() {
  const { data, error } = await supabase.rpc('active_suspensions')
  if (error) throw error
  return data || []
}

/**
 * Who may play in this game (admin / league manager / judge): one row per player on
 * either roster (players.team_id, player_teams, or signed up for the game) —
 * {player_id, team_id, suspended, suspension_games_remaining, medical_valid,
 * medical_expires_at}. A card issued IN this game doesn't count against it.
 * Pure rules for reading the rows live in ./eligibility.js.
 */
export async function getGamePlayerEligibility(gameId) {
  const { data, error } = await supabase.rpc('game_player_eligibility', { p_game_id: gameId })
  if (error) throw error
  return data || []
}
