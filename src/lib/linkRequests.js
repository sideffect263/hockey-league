import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * The two roads from an account to a player card — CLAIM an existing card
 * (player_claims, lib/claims.js) or SUBMIT a new one (player_submissions,
 * lib/playerSubmissions.js) — seen together. The DB allows ONE open request per
 * account across both tables and none once linked (guard_player_link_request), so
 * the UI has to read both before offering either.
 */

const REJECTION_VISIBLE_DAYS = 14

/**
 * Pending claim, pending submission and the most recent rejection (if it is recent
 * and nothing newer is open) for the signed-in account.
 *
 * THROWS on any failed read. A failed read must never render as "nothing pending":
 * that is how a user with a request in flight gets offered the claim buttons again.
 */
export async function getMyLinkState() {
  const user = await sessionUser()
  if (!user) return { pendingClaim: null, pendingSubmission: null, lastRejection: null }
  const cutoff = new Date(Date.now() - REJECTION_VISIBLE_DAYS * 86400000).toISOString()
  const [claims, subs] = await Promise.all([
    supabase.from('player_claims')
      .select('id, player_id, status, decision_note, created_at, reviewed_at, players(first_name, last_name)')
      .eq('profile_id', user.id)
      .or(`status.eq.pending,and(status.eq.rejected,reviewed_at.gte.${cutoff})`)
      .order('created_at', { ascending: false }),
    supabase.from('player_submissions')
      .select('id, first_name, last_name, status, decision_note, created_at, reviewed_at, teams(id, name)')
      .eq('profile_id', user.id)
      .or(`status.eq.pending,and(status.eq.rejected,reviewed_at.gte.${cutoff})`)
      .order('created_at', { ascending: false }),
  ])
  if (claims.error) throw claims.error
  if (subs.error) throw subs.error

  const pendingClaim = claims.data.find(c => c.status === 'pending') || null
  const pendingSubmission = subs.data.find(s => s.status === 'pending') || null
  const rejections = [
    ...claims.data.filter(c => c.status === 'rejected').map(c => ({
      kind: 'claim', at: c.reviewed_at, reason: c.decision_note,
      name: c.players ? `${c.players.first_name} ${c.players.last_name}` : null,
    })),
    ...subs.data.filter(s => s.status === 'rejected').map(s => ({
      kind: 'submission', at: s.reviewed_at, reason: s.decision_note,
      name: `${s.first_name} ${s.last_name}`,
    })),
  ].sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  const lastRejection = pendingClaim || pendingSubmission ? null : rejections[0] || null
  return { pendingClaim, pendingSubmission, lastRejection }
}

/** Ids of players already linked to SOME account (profiles is publicly readable). */
export async function getLinkedPlayerIds() {
  const { data, error } = await supabase
    .from('profiles').select('player_id').not('player_id', 'is', null)
  if (error) throw error
  return new Set(data.map(r => r.player_id))
}

/**
 * Hebrew copy for any error from creating a claim or a submission. Covers the guard
 * trigger's codes, the per-table unique index (23505) and the client wrappers' codes.
 */
export function linkRequestErrorMessage(e) {
  const msg = `${e?.message || ''}`
  if (/request_already_pending|submission-already-pending/.test(msg))
    return 'כבר יש לך בקשה ממתינה — אפשר לבטל אותה בעמוד החשבון'
  if (/profile_already_linked/.test(msg)) return 'החשבון שלך כבר משויך לשחקן'
  if (/player_already_linked/.test(msg)) return 'כרטיס השחקן הזה כבר משויך לחשבון אחר'
  if (e?.code === '23505') return 'כבר קיימת בקשה כזו'
  if (msg === 'not-authenticated') return 'יש להתחבר תחילה'
  return 'שליחת הבקשה נכשלה, נסו שוב'
}

/** "יואב בן דוד" → { firstName: "יואב", lastName: "בן דוד" } — prefill for a new card. */
export function splitName(q) {
  const parts = `${q || ''}`.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }
}
