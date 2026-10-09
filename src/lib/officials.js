import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * Officials (judges + medics) assignment, self-submission, and pay (epic D).
 * All writes go through SECURITY DEFINER RPCs gated to admin/league-manager (assign,
 * review, rates) or the official themselves (apply). League managers can't read
 * user_roles / game_officials broadly, so the read helpers are definer RPCs too.
 */

export const OFFICIAL_ROLES = ['judge', 'medic']
export const OFFICIAL_ROLE_LABEL = { judge: 'שופט', medic: 'חובש' }

// ---- reads (admin/LM) ----
export async function listAssignableOfficials() {
  const { data, error } = await supabase.rpc('list_assignable_officials')
  if (error) throw error
  return data || []
}

export async function getOfficialsOverview() {
  const { data, error } = await supabase.rpc('game_officials_overview')
  if (error) throw error
  return data || []
}

export async function getOfficialRates() {
  const { data, error } = await supabase.from('official_rates').select('role,rate')
  if (error) return { judge: 0, medic: 0 }
  return Object.fromEntries((data || []).map(r => [r.role, Number(r.rate) || 0]))
}

export async function getOfficialsPaylog() {
  const { data, error } = await supabase.rpc('officials_paylog')
  if (error) throw error
  return data || []
}

// ---- writes ----
export async function assignOfficial(gameId, userId, role) {
  const { error } = await supabase.rpc('assign_official', { p_game_id: gameId, p_user_id: userId, p_role: role })
  if (error) throw error
}

export async function removeOfficial(id) {
  const { error } = await supabase.rpc('remove_official', { p_id: id })
  if (error) throw error
}

// ---- the game's judge ----
// game_officials is the ONE record of who judges a game; games.referee_id is a mirror the
// DB keeps (trg_mirror_referee). Never write referee_id from a client.

/** "The judge of this game is userId" (null = nobody). Replaces any other approved judge. */
export async function setGameJudge(gameId, userId) {
  const { error } = await supabase.rpc('set_game_judge', { p_game_id: gameId, p_user_id: userId || null })
  if (error) throw error
}

/** Edit-form picker (admin/LM): every judge account; plays_in_game = his own team plays. */
export async function getGameJudgeOptions(gameId) {
  const { data, error } = await supabase.rpc('game_judge_options', { p_game_id: gameId || null })
  if (error) throw error
  return data || []
}

/** Public: approved judges' names for these games → Map(game_id → [{user_id,name,player_slug}]). */
export async function getGameJudges(gameIds) {
  const ids = [...new Set((gameIds || []).filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase.rpc('game_judges', { p_game_ids: ids })
  if (error) throw error
  const out = new Map()
  for (const r of data || []) {
    if (!out.has(r.game_id)) out.set(r.game_id, [])
    out.get(r.game_id).push(r)
  }
  return out
}

export async function setOfficialRate(role, rate) {
  const { error } = await supabase.rpc('set_official_rate', { p_role: role, p_rate: Number(rate) || 0 })
  if (error) throw error
}

export async function reviewOfficialApplication(id, approve) {
  const { error } = await supabase.rpc('review_official_application', { p_id: id, p_approve: approve })
  if (error) throw error
}

// ---- self-submit (a judge/medic applies to work a game) ----
export async function applyAsOfficial(gameId, role) {
  const { error } = await supabase.rpc('apply_as_official', { p_game_id: gameId, p_role: role })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
}

/** My own official assignments/applications for a game (self-readable via RLS). */
export async function getMyOfficialRoles(gameId) {
  const user = await sessionUser()
  if (!user || !gameId) return []
  const { data, error } = await supabase
    .from('game_officials')
    .select('id,role,status')
    .eq('game_id', gameId)
    .eq('user_id', user.id)
  if (error) return []
  return data || []
}

/**
 * Games this user was CONFIRMED to judge. The judge page lists only these — previously
 * every judge saw every upcoming fixture, so there was nothing stopping one from opening
 * a board for a game he had nothing to do with.
 *
 * Both confirmed statuses count. A manager's direct assignment now writes 'approved'
 * (see migration `officials_assigned_status_collapse`), but this filtered on 'approved'
 * alone while the dropdown wrote 'assigned' — so an assigned judge simply never saw his
 * own game here. Historical rows may still read 'assigned'; accept both rather than
 * depend on the backfill having caught every one.
 */
export async function getMyApprovedGameIds(role = 'judge') {
  const user = await sessionUser()
  if (!user) return new Set()
  const { data, error } = await supabase
    .from('game_officials')
    .select('game_id')
    .eq('user_id', user.id)
    .eq('role', role)
    .in('status', ['assigned', 'approved'])
  if (error) return new Set()
  return new Set((data || []).map(r => r.game_id))
}
