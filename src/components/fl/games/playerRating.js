/**
 * EA FC-style player card numbers for the game-preview hero, from real league data only:
 * every completed game + game_stats row of every season (season_games / season_game_stats RPCs)
 * and real follower counts (follower_counts RPC — the team's own roster doesn't count).
 *
 * Five axes, each shown as its REAL value; the radar shape is the player's percentile among
 * players in the same position group (min MIN_GP games):
 *   שערים  — goals he scored THIS season only
 *   ניסיון — games he played, all seasons
 *   התקפה  — average goals HIS team scored in the games he played
 *   הגנה   — average goals his team CONCEDED in the games he played (fewer = better)
 *   אוהדים — people following him
 * OVR = the five percentiles, averaged and mapped to 45–99.
 */
export const MIN_GP = 3

const isGoalie = p => /goal|שוער/i.test(p?.position || "")

const AXES = [
  { key: "goals", label: "שערים" },
  { key: "att", label: "התקפה" },
  { key: "def", label: "הגנה" },
  { key: "fans", label: "אוהדים" },
  { key: "exp", label: "ניסיון" },
]

const played = g => g && g.home_score != null && g.away_score != null && !g.is_test

/** Per-player raw totals over all seasons. `players` = { id → { team_id, position } }. */
export function aggregate({ games, stats, players, currentSeasonId }) {
  const gameById = new Map(games.filter(played).map(g => [g.id, g]))
  const out = new Map()
  for (const s of stats) {
    if (!s.player_id || s.is_guest_player) continue
    const g = gameById.get(s.game_id)
    if (!g) continue
    const a = out.get(s.player_id) || { gp: 0, goals: 0, sgoals: 0, tgp: 0, scored: 0, conceded: 0 }
    a.gp++
    a.goals += s.goals || 0
    if (g.season_id === currentSeasonId) a.sgoals += s.goals || 0
    const pTeam = players[s.player_id]?.team_id
    const team = s.played_for_team_id
      || (pTeam === g.home_team_id || pTeam === g.away_team_id ? pTeam : null)
    if (team) {
      const home = team === g.home_team_id
      a.tgp++
      a.scored += home ? g.home_score : g.away_score
      a.conceded += home ? g.away_score : g.home_score
    }
    out.set(s.player_id, a)
  }
  return out
}

const raw = (a, fans) => ({
  goals: a.sgoals,
  exp: a.gp,
  att: a.tgp ? a.scored / a.tgp : null,
  def: a.tgp ? a.conceded / a.tgp : null,
  fans: fans || 0,
})

/** Share of `pool` below v (ties half), 0..1. `lowerIsBetter` flips it (goals conceded). */
function pct(pool, v, lowerIsBetter = false) {
  const xs = pool.filter(x => x != null)
  if (v == null || !xs.length) return 0.5
  let below = 0, eq = 0
  for (const x of xs) { if (lowerIsBetter ? x > v : x < v) below++; else if (x === v) eq++ }
  return (below + eq / 2) / xs.length
}

const fmt = (key, v) => v == null ? "–" : key === "att" || key === "def" ? v.toFixed(1) : String(v)

/** The card for one player id, or null when he has no completed games on record.
 *  `fans` = { id → follower count }. */
export function playerCard(playerId, { totals, players, fans = {} }) {
  const a = totals.get(playerId)
  const me = players[playerId]
  if (!a || !me) return null
  const goalie = isGoalie(me)
  const peers = [...totals.entries()]
    .filter(([id, t]) => t.gp >= MIN_GP && isGoalie(players[id]) === goalie)
    .map(([id, t]) => raw(t, fans[id]))
  const mine = raw(a, fans[playerId])
  const axes = AXES.map(ax => {
    const p = pct(peers.map(m => m[ax.key]), mine[ax.key], ax.key === "def")
    return { ...ax, value: mine[ax.key], shown: fmt(ax.key, mine[ax.key]), pct: p }
  })
  const ovr = Math.round(45 + 54 * (axes.reduce((s, ax) => s + ax.pct, 0) / axes.length))
  return { ovr, axes, goalie }
}
