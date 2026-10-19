import { supabase } from './supabase'

/**
 * Duplicate-card check for "new player card" requests (2026-10-14).
 *
 * גיא ישראלי signed up and asked for a NEW card "גאי ישראלי" while his card "גאי ישראלי ורד" already existed on the
 * same team; the request was approved and the league had two of him (merged 2026-10-13). Same story as the earlier
 * Ido / Tomer / Hélder duplicates. Reviewers see a warning with the existing card before they approve.
 *
 * Hebrew names are spelled loosely (גיא / גאי / גי, final letters, a second surname), so names are compared with
 * the vowel letters א ו י removed and final letters folded.
 */

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }
const clean = (s) => (s || '').normalize('NFC').replace(/[׳״'"`\-.,()]/g, ' ').replace(/[ךםןףץ]/g, c => FINALS[c])
  .replace(/\s+/g, ' ').trim().toLowerCase()
const loose = (s) => clean(s).replace(/[אוי]/g, '')
const tokens = (s) => clean(s).split(' ').filter(Boolean).map(loose).filter(Boolean)

/** How a submission (first/last/jersey/team) resembles an existing player, or null. */
export function matchReason(sub, p) {
  const sameFirst = loose(sub.first_name) !== '' && loose(sub.first_name) === loose(p.first_name)
  const a = tokens(sub.last_name), b = tokens(p.last_name)
  const lastOverlap = a.length > 0 && b.length > 0 && (a.every(t => b.includes(t)) || b.every(t => a.includes(t)))
  const sameTeam = sub.team_id === p.team_id
  if (sameFirst && lastOverlap) return sameTeam ? 'same-name' : 'same-name-other-team'
  if (sameTeam && sameFirst && sub.jersey_number != null && sub.jersey_number === p.jersey_number) return 'same-number'
  return null
}

/** For each submission id -> [{ player, reason }] of existing cards it probably duplicates (same team first). */
export async function findLikelyDuplicates(submissions) {
  if (!submissions?.length) return {}
  // players has column-level grants: name the columns (select('*') 403s the whole request)
  const { data, error } = await supabase.from('players')
    .select('id,first_name,last_name,jersey_number,team_id,games_played,slug')
  if (error) return {}
  const out = {}
  for (const s of submissions) {
    const hits = []
    for (const p of data || []) {
      const reason = matchReason(s, p)
      if (reason) hits.push({ player: p, reason })
    }
    const rank = { 'same-name': 0, 'same-number': 1, 'same-name-other-team': 2 }
    if (hits.length) out[s.id] = hits.sort((x, y) => rank[x.reason] - rank[y.reason]).slice(0, 3)
  }
  return out
}

/** Admin / league manager: link the requester's account to the EXISTING card, then close the request. */
export async function linkToExistingCard(submission, player) {
  const { error } = await supabase.rpc('admin_link_player', { p_profile_id: submission.profile_id, p_player_id: player.id })
  if (error) {
    if (/already linked/i.test(error.message || '')) throw new Error('player-already-linked')
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
  const name = `${player.first_name} ${player.last_name}`.trim()
  const { error: e2 } = await supabase.rpc('reject_player_submission', {
    p_submission_id: submission.id,
    p_reason: `כבר יש לך כרטיס בליגה (${name}) — חיברנו אותו לחשבון שלך, אין צורך בכרטיס חדש`,
  })
  if (e2) throw e2
}
