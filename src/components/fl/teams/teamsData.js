/**
 * Pure helpers for the Floodlight teams area (standings, scorers, rounds).
 * Ports of iOS FLScorers.ranked and FLRounds.lastPlayedRound.
 */
import { countsForStats } from '@/lib/leagueStats'

const he = (a, b) => (a || '').localeCompare(b || '', 'he')
export const playerName = (p) => `${p?.first_name || ''} ${p?.last_name || ''}`.trim()

/**
 * Field players with goals, best first; ties alphabetical. `top` keeps everyone level
 * with the last place shown (a tie is never cut). Ranks are shared: 1, 2, 3, 4, 4, 4.
 */
export function rankScorers(players, top = null) {
  const sorted = (players || [])
    .filter((p) => p.position !== 'Goalkeeper' && (p.goals || 0) > 0)
    .sort((a, b) => (b.goals || 0) - (a.goals || 0) || he(playerName(a), playerName(b)))
  let list = sorted
  if (top && sorted.length > top) {
    const cutoff = sorted[top - 1].goals
    list = sorted.filter((p, i) => i < top || p.goals === cutoff)
  }
  return list.map((p) => ({ player: p, rank: list.findIndex((q) => q.goals === p.goals) + 1 }))
}

/** "שוויון נשאר שוויון: …" for the largest shared rank, or null. */
export function tieNote(list) {
  const groups = {}
  for (const e of list) (groups[e.rank] ||= []).push(e)
  let best = null
  for (const [rank, m] of Object.entries(groups)) if (m.length > 1 && (!best || m.length > best.m.length)) best = { rank, m }
  if (!best) return null
  return `שוויון נשאר שוויון: כל השחקנים עם ${best.m[0].player.goals} שערים חולקים את מקום ${best.rank}.`
}

const ilDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
const isLeague = (g) => !g.tournament_id && (!g.game_type || g.game_type === 'ליגה')

/** The last league round (game day) that has a result, 1-based; null before any. */
export function lastPlayedRound(games) {
  const league = (games || []).filter((g) => isLeague(g) && g.game_date && !g.playoff_round)
  const days = [...new Set(league.map((g) => ilDay(g.game_date)))].sort()
  const done = league.filter((g) => g.status === 'completed').map((g) => days.indexOf(ilDay(g.game_date)) + 1)
  return done.length ? Math.max(...done) : null
}

/** A team's last five competitive results, newest first: 1 win, 0 tie, -1 loss. */
export function teamForm(games, teamId, n = 5) {
  return (games || [])
    .filter((g) => g.status === 'completed' && countsForStats(g) && (g.home_team_id === teamId || g.away_team_id === teamId))
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
    .slice(0, n)
    .map((g) => {
      const home = g.home_team_id === teamId
      const my = (home ? g.home_score : g.away_score) ?? 0
      const op = (home ? g.away_score : g.home_score) ?? 0
      return my > op ? 1 : my < op ? -1 : 0
    })
}

/**
 * Multi-goal games (Ariel 10-28): ONLY games where one player scored 3, 4 or 5+ goals
 * count; a 2-goal game is not counted anywhere. From `game_stats` (caller shows the
 * coverage caveat). → { players: Map(id → {three,four,five}), teams: Map(id → {…}) }
 * `three` / `four` are exact, `five` = 5 or more.
 */
export function multiGoalCounts(gameStats = [], players = []) {
  const teamOf = new Map(players.map((p) => [p.id, p.team_id]))
  const P = new Map(), T = new Map()
  const bump = (m, k, key) => {
    if (k == null) return
    if (!m.has(k)) m.set(k, { three: 0, four: 0, five: 0 })
    m.get(k)[key] += 1
  }
  for (const s of gameStats) {
    if (!s.player_id) continue
    const g = s.goals || 0
    const key = g >= 5 ? 'five' : g === 4 ? 'four' : g === 3 ? 'three' : null
    if (!key) continue
    bump(P, s.player_id, key)
    bump(T, s.played_for_team_id || teamOf.get(s.player_id), key)
  }
  return { players: P, teams: T }
}
