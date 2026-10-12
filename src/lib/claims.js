import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * Player-claim flow (Stage B1). A logged-in user files a PENDING claim on a
 * player record; an admin approves (links profiles.player_id + grants the
 * 'player' role) or rejects. Self-linking is blocked at the DB by
 * guard_profile_player_id(); only admins can set profiles.player_id.
 *
 * Lives in its own file (not api.js) so the two parallel sessions don't collide.
 */

// ----- claimant (player-page) side -----

/**
 * Everything the player page needs in one round-trip:
 *  - userId: current auth user id (null if signed out)
 *  - profile: the user's profiles row (has player_id if already linked)
 *  - pendingClaim: the user's open claim, if any (across all players)
 *  - pendingSubmission: the user's open NEW-card submission, if any (blocks claiming)
 *  - playerOwnerId: profile id that already owns THIS player, or null
 */
export async function getClaimContext(playerId) {
  const user = await sessionUser()

  const { data: owner, error: ownerErr } = await supabase
    .from('profiles').select('id').eq('player_id', playerId).maybeSingle()
  if (ownerErr) throw ownerErr

  let profile = null, pendingClaim = null, pendingSubmission = null
  if (user) {
    const [{ data: p, error: pErr }, { data: c, error: cErr }, { data: s, error: sErr }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('player_claims').select('*').eq('profile_id', user.id).eq('status', 'pending').maybeSingle(),
      supabase.from('player_submissions').select('id').eq('profile_id', user.id).eq('status', 'pending').maybeSingle(),
    ])
    if (pErr) throw pErr
    if (cErr) throw cErr
    if (sErr) throw sErr
    profile = p; pendingClaim = c; pendingSubmission = s
  }

  return { userId: user?.id ?? null, profile, pendingClaim, pendingSubmission, playerOwnerId: owner?.id ?? null }
}

export async function createClaim(playerId, note) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  const { data, error } = await supabase
    .from('player_claims')
    .insert({ profile_id: user.id, player_id: playerId, note: note || null })
    .select().single()
  if (error) throw error
  return data
}

export async function cancelClaim(claimId) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  // Mirror the DELETE RLS policy in the query (own + pending) instead of relying
  // on it silently, and read back the deleted rows so we can tell the caller when
  // nothing matched (e.g. the claim was already approved/rejected).
  const { data, error } = await supabase
    .from('player_claims')
    .delete()
    .eq('id', claimId)
    .eq('profile_id', user.id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('claim-not-cancelable')
}

// ----- admin review side -----

/** All pending claims, joined to the requested player and the claimant profile. */
export async function getPendingClaims() {
  const { data, error } = await supabase
    .from('player_claims')
    // NEVER `players(*)` here: `authenticated` holds column-level SELECT grants on
    // players and birth_date is deliberately NOT among them (minors' DOBs go through
    // the gated RPCs). A star expands to birth_date too, so the whole request 403s —
    // which is exactly how this queue died once. List the columns the queue uses.
    .select('*, players(id, first_name, last_name, team_id), profiles!player_claims_profile_id_fkey(id, display_name, avatar_url)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

/**
 * Approve a claim via the SECURITY DEFINER RPC. The function is self-gated on
 * is_admin() OR is_coach_of(<the claimed player's team>); under definer rights it
 * links profiles.player_id, upserts the team-scoped 'player' user_roles row, and
 * marks the claim approved. The caller therefore needs no direct write policies.
 *
 * Errors are surfaced as stable codes, translated to Hebrew in ClaimsReview:
 *  - 23505           → the player is already linked to another account
 *                      (profiles.player_id is UNIQUE)
 *  - "not authorized" → the caller may not review this claim (not an admin and
 *                      not the coach of the player's team)
 */
export async function approveClaim(claimId) {
  const { error } = await supabase.rpc('approve_claim', { p_claim_id: claimId })
  if (error) {
    if (error.code === '23505') throw new Error('player-already-linked')
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
}

/** Optional reason → player_claims.decision_note, and into the claimant's notification. */
export async function rejectClaim(claimId, reason) {
  const { error } = await supabase.rpc('reject_claim', { p_claim_id: claimId, p_reason: reason || null })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
}
