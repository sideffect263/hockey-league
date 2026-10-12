import { supabase } from './supabase'

/**
 * הוקי מרקט on the game page — the pure rules behind GameMarketCard.
 *
 * The data comes from the `market_game_odds` RPC, which returns null unless the viewer
 * is market_eligible (18+). The age rule lives on the server: a null, an error, or a
 * function that isn't deployed yet all mean "no card", never a card for the wrong person.
 * The same rules are mirrored in the iOS and Android cards — keep them in step.
 */

export async function getGameMarketOdds(gameId) {
  if (!gameId) return null
  const { data, error } = await supabase.rpc('market_game_odds', { p_game: gameId })
  if (error || !data || typeof data !== 'object') return null
  return data
}

const num = v => (v == null || v === '' ? null : Number(v))

/** home / draw / away outcomes with numeric prices (null when absent). */
export function sidesOf(odds) {
  const by = k => {
    const o = (odds?.outcomes || []).find(x => x.okey === k)
    return o ? { ...o, price: num(o.price) ?? 0, was: num(o.was) } : null
  }
  return { home: by('home'), draw: by('draw'), away: by('away') }
}

/** Nothing to show: no data, a voided market, or a finished market nobody traded. */
export function isHidden(odds) {
  if (!odds || !Array.isArray(odds.outcomes) || odds.outcomes.length === 0) return true
  if (odds.status === 'void') return true
  if (odds.status === 'resolved' && !(Number(odds.trades) > 0)) return true
  return false
}

/** 'favourite' (with the leader's okey) when the top price leads by ≥10 points, else 'close'. */
export function leaderChip(odds) {
  const ranked = (odds?.outcomes || []).map(o => ({ okey: o.okey, p: num(o.price) ?? 0 })).sort((a, b) => b.p - a.p)
  if (ranked.length < 2) return null
  return ranked[0].p - ranked[1].p >= 0.1 ? { kind: 'favourite', okey: ranked[0].okey } : { kind: 'close' }
}

/** Change over 48 h in whole points, or null under the 3-point threshold. */
export function trendPoints(outcome) {
  if (!outcome || outcome.was == null) return null
  const d = Number(outcome.price) - Number(outcome.was)
  return Math.abs(d) >= 0.03 ? Math.round(d * 100) : null
}

/** Payout per coin if this outcome wins (×1.14), null when the price is ~0. */
export function multiplier(price) {
  const p = Number(price)
  return p >= 0.01 ? (1 / p).toFixed(2) : null
}

/**
 * The resolved card's one-line verdict.
 * w < 0.34 → upset · w ≥ 0.5 → the market called it · otherwise a plain result.
 */
export function resolvedHeadline(winnerLabel, winnerPrice, isDraw) {
  const w = Number(winnerPrice) || 0
  const p = `${Math.round(w * 100)}%`
  if (w < 0.34) return { tone: 'upset', text: isDraw ? `🔥 הפתעה! השוק נתן לתיקו רק ${p}` : `🔥 הפתעה! השוק נתן ל${winnerLabel} רק ${p}` }
  if (w >= 0.5) return { tone: 'called', text: isDraw ? `השוק צדק — תיקו היה הפייבוריט (${p})` : `השוק צדק — ${winnerLabel} היו הפייבוריטים (${p})` }
  return { tone: 'plain', text: isDraw ? `תיקו — ${p} לפני המשחק` : `${winnerLabel} ניצחו עם ${p} לפני המשחק` }
}

/** "בעוד 3 ימים" / "היום ב-18:30" / "מחר ב-18:30" for the close time. */
export function closesLabel(iso, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  const TZ = 'Asia/Jerusalem'
  const day = x => x.toLocaleDateString('en-CA', { timeZone: TZ })
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  const days = Math.round((new Date(day(d)) - new Date(day(now))) / 86400000)
  if (days <= 0) return `היום ב-${time}`
  if (days === 1) return `מחר ב-${time}`
  return `בעוד ${days} ימים`
}

/** History as [{home, away}] numbers, oldest first; [] when there is no movement to draw. */
export function sparkSeries(odds) {
  const h = (odds?.history || []).map(p => ({ home: num(p.home), away: num(p.away) })).filter(p => p.home != null && p.away != null)
  return h.length >= 2 ? h : []
}
