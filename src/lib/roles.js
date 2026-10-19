import { supabase } from './supabase'

/**
 * Admin role management (Stage B). Roles live in `user_roles` (player / coach /
 * content_editor / judge, optionally team-scoped) and are admin-managed by the
 * existing RLS ("Admin manages roles" FOR ALL; "Read own roles or admin"). No
 * migration needed. Kept out of api.js to avoid collision with other workstreams.
 */

export const ROLES = ['player', 'coach', 'content_editor', 'judge', 'league_manager', 'medic', 'developer']
// Roles the admin can grant from the Roles tab. Excludes 'player': players are
// defined in the Players tab and linked to an account by the "שייך שחקן" picker on
// each user row (or by claim approval) — both set profiles.player_id AND the role.
// Inserting a bare 'player' user_roles row here would do nothing. `ROLES` stays intact for label/badge lookups on existing rows.
export const GRANTABLE_ROLES = ROLES.filter(r => r !== 'player')
export const ROLE_LABEL = {
  player: 'שחקן',
  coach: 'מאמן',
  content_editor: 'עורך תוכן',
  judge: 'שופט',
  league_manager: 'מנהל ליגה',
  medic: 'חובש',
  developer: 'מפתח/ת',
}
// Roles that are scoped to a specific team.
export const TEAM_SCOPED = new Set(['coach', 'player'])

export async function getProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, player_id, is_bot')
    .order('display_name')
  if (error) throw error
  return data
}

// Admin reads every row via RLS.
export async function getAllRoles() {
  const { data, error } = await supabase.from('user_roles').select('*')
  if (error) throw error
  return data
}

export async function grantRole(userId, role, teamId = null) {
  const { error } = await supabase
    .from('user_roles')
    .insert({ user_id: userId, role, team_id: TEAM_SCOPED.has(role) ? teamId : null })
  if (error) throw error
}

// Move a team-scoped role (e.g. a coach) to another team, keeping the same row.
export async function moveRoleTeam(id, teamId) {
  const { error } = await supabase.from('user_roles').update({ team_id: teamId }).eq('id', id)
  if (error) throw error
}

export async function revokeRole(id) {
  const { error } = await supabase.from('user_roles').delete().eq('id', id)
  if (error) throw error
}

/**
 * Link a user account to a player card, or unlink it (playerId = null), via the
 * admin_link_player RPC (admin / league manager only — profiles.player_id is
 * guarded by guard_profile_player_id()).
 *
 * The claim flow (a user asks, an admin approves in the בקשות tab) is still the
 * normal path. This is the admin-initiated one, for the player who never files a
 * claim — most of the squad. Linking also grants the team-scoped 'player' role
 * and closes a matching pending claim, exactly like approve_claim does.
 */
export async function linkPlayer(profileId, playerId) {
  const { error } = await supabase.rpc('admin_link_player', {
    p_profile_id: profileId,
    p_player_id: playerId || null,
  })
  if (error) {
    const m = error.message || ''
    if (/player already linked/i.test(m) || error.code === '23505') throw new Error('player-already-linked')
    if (/not authorized/i.test(m)) throw new Error('not-authorized')
    if (/player not found/i.test(m)) throw new Error('player-not-found')
    throw error
  }
}

/**
 * Permanently delete a user account (admin only) via the admin_delete_user RPC.
 * Frees the email (forcing re-signup) and cascades the profile + roles + posts +
 * comments + likes + pending claims/submissions. The linked player record
 * (stats/history) is preserved — only the account link is removed.
 */
export async function deleteUser(userId) {
  const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId })
  if (error) {
    if (/cannot delete yourself/i.test(error.message || '')) throw new Error('cannot-delete-self')
    if (/cannot delete an admin/i.test(error.message || '')) throw new Error('cannot-delete-admin')
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
}
