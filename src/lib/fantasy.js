import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * ליגת הפנטזי (supabase/fantasy.sql).
 *
 * Every rule here is enforced again by the server (fantasy_save_lineup). The copies
 * on this side exist only so the builder can explain a problem before you press
 * save, so if you change one, change both.
 */

export const SQUAD = { gk: 1, f: 4, bgk: 1, bf: 1 }
export const SLOTS = ['gk', 'f', 'f', 'f', 'f', 'bgk', 'bf']
export const isGkSlot = slot => slot === 'gk' || slot === 'bgk'
export const isBench = slot => slot === 'bgk' || slot === 'bf'

/** The scoring table, in the order the rules tab prints it. Mirrors fantasy_player_game_points. */
export const SCORING = [
  { label: 'שיחק במשחק', pts: '+1' },
  { label: 'שער של שחקן שדה', pts: '+2' },
  { label: 'שער של שוער', pts: '+6' },
  { label: 'ניצחון הקבוצה', pts: '+2' },
  { label: 'תיקו', pts: '+1' },
  { label: 'שוער: 0 ספיגות', pts: '+6' },
  { label: 'שוער: 1–2 ספיגות', pts: '+4' },
  { label: 'שוער: 3–4 ספיגות', pts: '+2' },
  { label: 'שוער: 5–6 ספיגות', pts: '+1' },
  { label: 'MVP של המשחק', pts: '+3' },
  { label: 'כרטיס כחול', pts: '−1' },
  { label: 'כרטיס צהוב', pts: '−2' },
  { label: 'כרטיס אדום', pts: '−3' },
]

/** An empty lineup: one entry per slot, in SLOTS order. */
export const emptyLineup = () => SLOTS.map(slot => ({ slot, player_id: null, captain: false }))

/** Server lineup rows → our slot array (keeps SLOTS order so the rink draws stably). */
export function fromServer(rows) {
  const out = emptyLineup()
  const used = new Set()
  for (const r of rows || []) {
    const i = out.findIndex((s, k) => s.slot === r.slot && !s.player_id && !used.has(k))
    if (i >= 0) { out[i] = { slot: r.slot, player_id: r.player_id, captain: !!r.captain }; used.add(i) }
  }
  return out
}

export const toServer = lineup => lineup.map(s => ({ player_id: s.player_id, slot: s.slot, captain: !!s.captain }))

export const lineupIds = lineup => lineup.map(s => s.player_id).filter(Boolean)

export function lineupCost(lineup, byId) {
  return lineupIds(lineup).reduce((sum, id) => sum + Number(byId.get(id)?.price ?? 5), 0)
}

export function teamCounts(lineup, byId, exceptSlot = -1) {
  const m = new Map()
  lineup.forEach((s, i) => {
    if (i === exceptSlot || !s.player_id) return
    const t = byId.get(s.player_id)?.team_id
    if (t) m.set(t, (m.get(t) || 0) + 1)
  })
  return m
}

/** Players new to the squad compared with the one the next round's transfers count against. */
export function transfersAgainst(lineup, baseSquad) {
  if (!baseSquad || baseSquad.length === 0) return 0
  const base = new Set(baseSquad)
  return lineupIds(lineup).filter(id => !base.has(id)).length
}

export const transferPenalty = (n, cost = 3) => Math.max(0, n - 1) * cost

/**
 * Why `player` cannot go into slot index `i` right now, or null if he can.
 * Used to grey out the picker rows with a reason.
 */
export function blockReason(player, i, lineup, byId, state) {
  const slot = lineup[i].slot
  if (isGkSlot(slot) !== !!player.gk) return player.gk ? 'שוער' : 'שחקן שדה'
  if (state?.my_player_id && player.id === state.my_player_id) return 'זה אתם'
  if (lineup.some((s, k) => k !== i && s.player_id === player.id)) return 'כבר בקבוצה'
  const counts = teamCounts(lineup, byId, i)
  if ((counts.get(player.team_id) || 0) >= (state?.max_per_team ?? 2)) return `כבר ${state?.max_per_team ?? 2} מהקבוצה`
  const current = lineup[i].player_id ? Number(byId.get(lineup[i].player_id)?.price ?? 5) : 0
  const left = (state?.budget ?? 50) - lineupCost(lineup, byId) + current
  if (Number(player.price) > left + 1e-9) return 'מעל התקציב'
  return null
}

/** Everything wrong with a lineup, as short Hebrew lines. Empty = ready to save. */
export function lineupProblems(lineup, byId, state, name) {
  const out = []
  const missing = lineup.filter(s => !s.player_id).length
  if (missing) out.push(`חסרים ${missing} שחקנים`)
  const cost = lineupCost(lineup, byId)
  if (cost > (state?.budget ?? 50) + 1e-9) out.push(`חריגה מהתקציב (${fmtPrice(cost)})`)
  for (const [t, n] of teamCounts(lineup, byId)) {
    if (n > (state?.max_per_team ?? 2)) out.push(`יותר מ-${state?.max_per_team ?? 2} שחקנים מ${state?.teams?.find(x => x.id === t)?.name || 'אותה קבוצה'}`)
  }
  if (!lineup.some(s => s.captain && !isBench(s.slot) && s.player_id)) out.push('בחרו קפטן')
  const nm = String(name || '').trim()
  if (nm.length < 2 || nm.length > 24) out.push('תנו שם לקבוצה (2–24 תווים)')
  return out
}

export const fmtPrice = p => Number(p).toFixed(1)

// ---------------------------------------------------------------- server calls

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message || 'שגיאה')
  return data
}

export const getFantasyState = () => rpc('fantasy_state')
export const saveLineup = (name, lineup) => rpc('fantasy_save_lineup', { p_name: String(name).trim(), p_lineup: toServer(lineup) })
export const getLeaderboard = (leagueId = null, limit = 100) => rpc('fantasy_leaderboard', { p_league: leagueId, p_limit: limit })
export const getEntryRound = (entryId, round) => rpc('fantasy_entry_round', { p_entry: entryId, p_round: round })
export const createLeague = name => rpc('fantasy_create_league', { p_name: String(name).trim() })
export const joinLeague = code => rpc('fantasy_join_league', { p_code: String(code).trim() })
export const leaveLeague = id => rpc('fantasy_leave_league', { p_league: id })
export const leagueByCode = code => rpc('fantasy_league_by_code', { p_code: String(code).trim() })

export const inviteLink = code =>
  `${typeof window !== 'undefined' ? window.location.origin : 'https://rinkhockeyil.com'}/fantasy?join=${encodeURIComponent(code)}`

/**
 * Whether the nav should list the page: the switch is on, or you are an admin /
 * developer (who can test it before launch). One read per tab.
 */
let flagPromise = null
export function useFantasyListed({ isAdmin, isDeveloper }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (isAdmin || isDeveloper) { setOn(true); return }
    flagPromise ||= supabase.from('league_settings').select('value').eq('key', 'feature_fantasy').maybeSingle()
      .then(({ data }) => data?.value === 'on').catch(() => false)
    let live = true
    flagPromise.then(v => { if (live) setOn(v) })
    return () => { live = false }
  }, [isAdmin, isDeveloper])
  return on
}

// ---------------------------------------------------------------- dates

const TZ = 'Asia/Jerusalem'
export function fmtRoundDate(d) {
  // round dates are plain YYYY-MM-DD; read them at noon so no timezone moves the day
  const dt = new Date(`${d}T12:00:00Z`)
  return dt.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: TZ })
}
export function fmtLock(ts) {
  const dt = new Date(ts)
  return dt.toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ })
}
export function untilText(ts, now = Date.now()) {
  const ms = new Date(ts).getTime() - now
  if (ms <= 0) return 'ננעל'
  const h = Math.floor(ms / 3.6e6)
  if (h >= 48) return `עוד ${Math.floor(h / 24)} ימים`
  if (h >= 1) return `עוד ${h} שעות`
  return `עוד ${Math.max(1, Math.floor(ms / 6e4))} דקות`
}
