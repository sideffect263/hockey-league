import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * Self-service player cards (#7). A logged-in user proposes a NEW player card
 * for a team; the team's coach (or an admin) approves via the
 * approve_player_submission RPC, which creates the real players row, links the
 * submitter's profile (profiles.player_id), and grants the team-scoped 'player'
 * role. Mirrors the player-claims flow (claims.js) but for players that don't
 * exist yet — so unapproved cards never appear in the public players table.
 *
 * Lives in its own file so parallel sessions don't collide.
 */

// ----- submitter side -----

/** The current user's open (pending) submission, if any (joined to its team). */
export async function getMyPlayerSubmission() {
  const user = await sessionUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('player_submissions')
    .select('*, teams(id, name, logo_url)')
    .eq('profile_id', user.id)
    .eq('status', 'pending')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createPlayerSubmission({ teamId, firstName, lastName, jerseyNumber, position, birthDate, note }) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  const { data, error } = await supabase
    .from('player_submissions')
    .insert({
      profile_id: user.id,
      team_id: teamId,
      first_name: firstName,
      last_name: lastName,
      jersey_number: jerseyNumber ?? null,
      position: position || null,
      // birth_date, not age: the loan rule (under 18 / goalkeeper) reads it, and
      // approve_player_submission copies it onto the new player.
      birth_date: birthDate || null,
      note: note || null,
    })
    .select().single()
  if (error) {
    // partial unique index (one pending per profile) → 23505
    if (error.code === '23505') throw new Error('submission-already-pending')
    throw error
  }
  return data
}

/**
 * Row 29 — "סטטוס מחכה מוצג בכרטיס שחקן". Submissions for one team, so the roster can
 * show a proposed player as pending instead of him simply not existing until approved.
 *
 * RLS decides who sees anything: the team's coach, the submitter, an admin or a league
 * manager. For everyone else this returns [] — an unapproved card must never surface on
 * the public team page.
 */
const REJECTED_VISIBLE_DAYS = 14

export async function getTeamSubmissions(teamId) {
  if (!teamId) return []
  // Pending rows stay until resolved. Rejections are shown only briefly — long enough
  // for the submitter to read the reason and resubmit. Keeping them forever turns the
  // roster into a permanent log of every card ever refused, including junk and troll
  // submissions from past seasons, which is noise at best and unpleasant at worst.
  const cutoff = new Date(Date.now() - REJECTED_VISIBLE_DAYS * 86400000).toISOString()
  const { data, error } = await supabase
    .from('player_submissions')
    .select('id,first_name,last_name,jersey_number,position,status,decision_note,created_at,reviewed_at')
    .eq('team_id', teamId)
    .or(`status.eq.pending,and(status.eq.rejected,reviewed_at.gte.${cutoff})`)
    .order('created_at', { ascending: false })
  if (error) return []
  return data || []
}

export async function cancelPlayerSubmission(id) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  // Mirror the DELETE RLS (own + pending) in the query and read back the deleted
  // rows so we can tell the caller when nothing matched (already reviewed).
  const { data, error } = await supabase
    .from('player_submissions')
    .delete()
    .eq('id', id)
    .eq('profile_id', user.id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('submission-not-cancelable')
}

// ----- reviewer (coach / admin) side -----

/** All pending submissions, joined to the target team and the submitter profile. */
export async function getPendingPlayerSubmissions() {
  const { data, error } = await supabase
    .from('player_submissions')
    .select('*, teams(id, name, logo_url), profiles!player_submissions_profile_id_fkey(id, display_name, avatar_url)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

/**
 * Approve via the SECURITY DEFINER RPC (self-gated to admin OR the team's coach):
 * creates the players row, links the submitter's profile, upserts the 'player'
 * role, and marks the submission approved. Errors surface as stable codes.
 */
export async function approvePlayerSubmission(id) {
  const { error } = await supabase.rpc('approve_player_submission', { p_submission_id: id })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
}

/**
 * Reject a submitted player card. A reason is REQUIRED (enforced server-side): the
 * submitter and the team's coach both receive it, so they know what to fix and can
 * resubmit. A bare "נדחה" is a dead end.
 */
export async function rejectPlayerSubmission(id, reason) {
  const { error } = await supabase.rpc('reject_player_submission', {
    p_submission_id: id, p_reason: reason || null,
  })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    if (/reason is required/i.test(error.message || '')) throw new Error('reason-required')
    throw error
  }
}
