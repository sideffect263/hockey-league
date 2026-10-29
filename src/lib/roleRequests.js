import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * Two request flows reviewed by a league manager / admin (supabase/official-role-requests.sql,
 * supabase/card-unlink-requests.sql):
 *   - official role: "I want to referee / run the table (מזכירות)". Approval grants the
 *     league-wide user_roles 'judge' row — the one role that opens the judge board.
 *   - card unlink ("זה לא הכרטיס שלי"): approval does what disconnect_my_pairing does.
 *
 * Until those migrations are applied the RPCs/tables do not exist. Every read here then
 * resolves to "nothing" (null / []) instead of throwing, so the pages render as before;
 * writes throw 'not-available' so the UI can say so.
 */

const isMissing = (error) => {
  const m = `${error?.code || ''} ${error?.message || ''}`
  return /PGRST202|PGRST205|42P01|42883|does not exist|Could not find/i.test(m)
}

const wrap = (error) => {
  if (isMissing(error)) return new Error('not-available')
  if (/not authorized/i.test(error?.message || '')) return new Error('not-authorized')
  if (/not-linked/i.test(error?.message || '')) return new Error('not-linked')
  if (/request not found/i.test(error?.message || '')) return new Error('request-not-found')
  return error
}

// ----- official role (referee / secretary) -----

export async function requestOfficialRole({ referee = false, secretary = false, note = null } = {}) {
  const { data, error } = await supabase.rpc('request_official_role', {
    p_referee: !!referee, p_secretary: !!secretary, p_note: note || null,
  })
  if (error) throw wrap(error)
  return data // null = already holds the role
}

export async function getMyOfficialRoleRequest() {
  const user = await sessionUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('official_role_requests')
    .select('id, status, wants_referee, wants_secretary, note, created_at')
    .eq('user_id', user.id).eq('status', 'pending')
    .maybeSingle()
  if (error) return null
  return data
}

export async function cancelOfficialRoleRequest() {
  const { data, error } = await supabase.rpc('cancel_official_role_request')
  if (error) throw wrap(error)
  return !!data
}

export async function getPendingOfficialRoleRequests() {
  const { data, error } = await supabase.rpc('pending_official_role_requests')
  if (error) {
    if (isMissing(error) || /not authorized/i.test(error.message || '')) return []
    throw error
  }
  return data || []
}

export async function decideOfficialRoleRequest(id, approve) {
  const { error } = await supabase.rpc('decide_official_role_request', { p_id: id, p_approve: approve })
  if (error) throw wrap(error)
}

// ----- card unlink ("זה לא הכרטיס שלי") -----

export async function requestCardUnlink(reason = null) {
  const { data, error } = await supabase.rpc('request_card_unlink', { p_reason: reason || null })
  if (error) throw wrap(error)
  return data
}

export async function getMyCardUnlinkRequest() {
  const user = await sessionUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('card_unlink_requests')
    .select('id, status, player_id, reason, created_at')
    .eq('user_id', user.id).eq('status', 'pending')
    .maybeSingle()
  if (error) return null
  return data
}

export async function cancelCardUnlinkRequest() {
  const { data, error } = await supabase.rpc('cancel_card_unlink_request')
  if (error) throw wrap(error)
  return !!data
}

export async function getPendingCardUnlinkRequests() {
  const { data, error } = await supabase.rpc('pending_card_unlink_requests')
  if (error) {
    if (isMissing(error) || /not authorized/i.test(error.message || '')) return []
    throw error
  }
  return data || []
}

/** Returns 'approved' | 'rejected' | 'stale' (the account was no longer on that card). */
export async function decideCardUnlinkRequest(id, approve) {
  const { data, error } = await supabase.rpc('decide_card_unlink_request', { p_id: id, p_approve: approve })
  if (error) throw wrap(error)
  return data
}

/** "שופט" / "מזכירות" / "שופט ומזכירות" for a request row. */
export const officialRoleLabel = (r) =>
  r?.wants_referee && r?.wants_secretary ? 'שופט ומזכירות' : r?.wants_secretary ? 'מזכירות' : 'שופט'
