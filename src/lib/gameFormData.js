import { supabase } from './supabase'
import { summarizeReport, gameCaptainIds } from './gameForm/summary.js'

// The pure readers live in gameForm/summary.js so api/game-form.js can use them too.
export { summarizeReport, gameCaptainIds }

/**
 * The match-sheet facts the box score never held — team fouls, timeouts, the half-time
 * score, captains — and the digital signatures on the game form.
 *
 * Fouls and timeouts come from `game_reports`, which a DB trigger fills from every live
 * broadcast (see supabase/game-form-signing.sql): the web judge's full engine snapshot
 * when there is one (exact), otherwise the merged play-by-play every judge app sends.
 * Games finished before 2026-10-11 have no archive — their fouls survive only on the
 * paper form, entered by hand into the same row (home_fouls, halftime_*, timeouts).
 */

export const SIGN_ROLES = ['referee', 'medic', 'home_coach', 'home_captain', 'away_coach', 'away_captain']

export async function getGameReportRow(gameId) {
  const { data, error } = await supabase.from('game_reports').select('*').eq('game_id', gameId).maybeSingle()
  if (error) throw error
  return data
}

// ---- the paper form's numbers + photos (admin / LM / judge) ----
export async function setGameSheet(gameId, { homeFouls, awayFouls, halftimeHome, halftimeAway, timeouts }) {
  const n = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
  const { error } = await supabase.rpc('set_game_sheet', {
    p_game_id: gameId,
    p_home_fouls: n(homeFouls), p_away_fouls: n(awayFouls),
    p_halftime_home: n(halftimeHome), p_halftime_away: n(halftimeAway),
    p_timeouts: timeouts || null,
  })
  if (error) throw error
}

export async function removeGameFormPhoto(gameId, path) {
  const { error } = await supabase.rpc('remove_game_form_photo', { p_game_id: gameId, p_path: path })
  if (error) throw error
}

// ---- captains ----
export async function setTeamCaptain(teamId, playerId) {
  const { error } = await supabase.rpc('set_team_captain', { p_team_id: teamId, p_player_id: playerId })
  if (error) throw error
}

export async function setGameCaptain(gameId, side, playerId) {
  const { error } = await supabase.rpc('set_game_captain', { p_game_id: gameId, p_side: side, p_player_id: playerId })
  if (error) throw error
}

// ---- signatures ----
export async function getMySignRoles(gameId) {
  const { data, error } = await supabase.rpc('game_sign_roles', { p_game_id: gameId })
  if (error) throw error
  return (data || []).map(r => (typeof r === 'string' ? r : r.game_sign_roles))
}

/** `{ [role]: { signer_name, signed_at, image, is_mine } }`, or null when not allowed to read. */
export async function getGameSignatures(gameId) {
  const { data, error } = await supabase.rpc('game_form_signatures', { p_game_id: gameId })
  if (error) return null
  return Object.fromEntries((data || []).map(s => [s.role, s]))
}

export async function signGameForm(gameId, role, pngDataUrl) {
  const { error } = await supabase.rpc('sign_game_form', { p_game_id: gameId, p_role: role, p_image: pngDataUrl })
  if (error) throw error
}

export async function clearGameSignature(gameId, role) {
  const { error } = await supabase.rpc('clear_game_signature', { p_game_id: gameId, p_role: role })
  if (error) throw error
}

// ---- saved signature (one per account; see supabase/game-form-sign-reminder.sql) ----
/** The caller's saved signature PNG data URL, or null. */
export async function getMySavedSignature() {
  const { data, error } = await supabase.rpc('my_saved_signature')
  if (error) throw error
  return data || null
}

export async function saveMySignature(pngDataUrl) {
  const { error } = await supabase.rpc('save_my_signature', { p_image: pngDataUrl })
  if (error) throw error
}

export async function deleteMySignature() {
  const { error } = await supabase.rpc('delete_my_signature')
  if (error) throw error
}

/** One tap: the server signs with the caller's saved signature. */
export async function signGameFormSaved(gameId, role) {
  const { error } = await supabase.rpc('sign_game_form_saved', { p_game_id: gameId, p_role: role })
  if (error) throw error
}
