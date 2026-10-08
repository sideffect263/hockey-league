import { supabase } from './supabase'

/**
 * Game availability (#3 apply-to-play). A rostered player declares whether they're
 * coming to an upcoming game; the team's coach (or an admin) sees the roster.
 * Writes go through the set_game_availability RPC (self-scoped to the caller's own
 * linked player); reads are RLS-scoped (the player sees their own row, a coach/admin
 * sees their team's).
 */

/** The current user's availability status for a game ('available'|'unavailable'|null). */
export async function getMyAvailability(gameId, playerId) {
  if (!gameId || !playerId) return null
  const { data, error } = await supabase
    .from('game_availability')
    .select('status')
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (error) return null
  return data?.status ?? null
}

/** Set the current user's availability via the self-scoped RPC. Signing up as
 *  "available" requires a valid approved medical certificate, no active red-card block
 *  AND no approved absence covering the game's date; registering at all requires the player to be on one of the two teams in the
 *  game. All three are enforced server-side (supabase/squad-rules.sql) — the UI hides
 *  the button, but the RPC is reachable directly. */
export async function setMyAvailability(gameId, status) {
  const { error } = await supabase.rpc('set_game_availability', { p_game_id: gameId, p_status: status })
  if (error) {
    const msg = error.message || ''
    if (/no valid medical/i.test(msg)) throw new Error('no-valid-medical')
    if (/suspended/i.test(msg)) throw new Error('suspended')
    // An APPROVED absence (injury / abroad / reserve duty) on the GAME's date — the gate
    // is date-scoped, so this can fire for one fixture and not the next.
    if (/unavailable/i.test(msg)) throw new Error('unavailable')
    if (/not in this game/i.test(msg)) throw new Error('not-in-game')
    throw error
  }
}

/** All availability rows for a game the caller may read (coach → their team; admin → all).
 *  `team_id` / `added_by` are set only on manually added players (a loaned goalkeeper or
 *  a one-time youth call-up); they are on neither roster, so the caller must merge them
 *  in rather than deriving the squad from players-by-team alone. */
export async function getGameAvailability(gameId) {
  if (!gameId) return []
  const { data, error } = await supabase
    .from('game_availability')
    .select('player_id,status,team_id,added_by,note')
    .eq('game_id', gameId)
  if (error) return []
  return data || []
}

/** Any signed-in user: who is coming / not coming on BOTH teams (status only — no
 *  notes or absence reasons). Ziv 2026-10-04: "as a player and as a viewer". */
export async function getPublicAttendance(gameId) {
  if (!gameId) return []
  const { data, error } = await supabase.rpc('game_attendance', { p_game_id: gameId })
  if (error) return []
  return data || []
}

/** Coach / admin / league manager: push a reminder to this team's players who have the
 *  app, can register, and haven't answered. Capped server-side at one per player per day.
 *  Returns how many were reminded. */
export async function nudgeNonResponders(gameId, teamId) {
  const { data, error } = await supabase.rpc('coach_nudge_game', { p_game_id: gameId, p_team_id: teamId })
  if (error) throw error
  return data ?? 0
}

/** Officials (judge/admin): availability for a game via a definer RPC (judges can't
 *  read the table via RLS). Used to default the scoreboard roster to attendees. */
export async function getGameAvailabilityForOfficial(gameId) {
  if (!gameId) return []
  const { data, error } = await supabase.rpc('game_availability_for_official', { p_game_id: gameId })
  if (error) return []
  return data || []
}

/** Officials (judge/admin): availability across several games via a definer RPC →
 *  attendance chips on the referee page. Returns [{game_id, player_id, status}]. */
export async function getAvailabilityForOfficialBatch(gameIds) {
  const ids = (gameIds || []).filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.rpc('game_availability_for_official_batch', { p_game_ids: ids })
  if (error) return []
  return data || []
}

/** Availability rows across several games (RLS-scoped) → for the games-list coach chips. */
export async function getAvailabilityForGames(gameIds) {
  const ids = (gameIds || []).filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('game_availability')
    .select('game_id,player_id,status')
    .in('game_id', ids)
  if (error) return []
  return data || []
}
