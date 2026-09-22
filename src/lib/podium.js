import { supabase } from './supabase'

/**
 * Podium mirror (2026-09-22). Players register and pay for the season in
 * podiumcomp.com — the federation's system — and separately in this app. A
 * scheduled Edge Function (`podium-sync`, every 6h) mirrors the Podium side into
 * public.podium_athletes / public.podium_payments so nobody has to keep two tabs
 * open to answer "is he registered" or "has he paid".
 *
 * Everything here is admin / league-manager only, enforced server-side: the tables
 * carry national ID numbers and contact details for adults and minors alike, and
 * have no `authenticated` grant.
 */

/** Every player card with his Podium registration + this season's payment. */
export async function getPaymentOverview() {
  const { data, error } = await supabase.rpc('podium_payment_overview')
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
  return data || []
}

/** Podium athletes with no player card here — the other half of the reconciliation. */
export async function getUnmatchedAthletes() {
  const { data, error } = await supabase.rpc('podium_unmatched_athletes')
  if (error) return []
  return data || []
}

/** Link a Podium athlete to a player card by hand (pass null to unlink). */
export async function linkPodiumAthlete(podiumId, playerId) {
  const { error } = await supabase.rpc('podium_link_athlete', {
    p_podium_id: podiumId, p_player: playerId,
  })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('אין לך הרשאה לשייך')
    throw new Error('השיוך נכשל')
  }
}

/** The last sync attempt, for the "מעודכן לפני X" line and for surfacing failures. */
export async function getLastSync() {
  const { data, error } = await supabase
    .from('podium_sync_runs')
    .select('id,started_at,finished_at,ok,athletes,payments,matched,error')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data
}

/**
 * Podium sits behind Cloudflare, which serves a managed challenge ("Just a
 * moment...") to datacenter IPs — so the deployed Edge Function cannot reach it
 * and the sync is run by hand from a laptop (scripts/podium-sync.mjs). The
 * function stays deployed and correct for the day Podium allowlists us; until
 * then this turns its 403 into a sentence that says what to actually do, rather
 * than a bare "failed".
 */
export const CLOUDFLARE_BLOCKED =
  'פודיום חוסם סנכרון אוטומטי מהשרת. יש להריץ את הסנכרון ידנית מהמחשב (scripts/podium-sync.mjs).'

export function isCloudflareBlock(message) {
  return /just a moment|cloudflare|403/i.test(message || '')
}

/**
 * Run the sync now. The function re-checks admin/league_manager itself — being
 * signed in is not enough, because this reaches out to a third party's server.
 */
export async function runPodiumSync() {
  const { data, error } = await supabase.functions.invoke('podium-sync')
  if (error) throw new Error('הסנכרון נכשל')
  if (data && data.ok === false) {
    throw new Error(isCloudflareBlock(data.error) ? CLOUDFLARE_BLOCKED : (data.error || 'הסנכרון נכשל'))
  }
  return data
}
