/**
 * EA FC-style player card numbers for the game-preview hero, computed from real league data:
 * every completed game + game_stats row of every season (season_games / season_game_stats RPCs).
 *
 * Each of the six attributes is the player's PERCENTILE inside his position group (field
 * players vs goalkeepers, min MIN_GP games), mapped to 45–99 so a card never reads as an
 * insult. OVR is a weighted mean of the six. Raw totals ride along so the card can also show
 * the plain numbers they came from.
 */
export const MIN_GP = 3

const isGoalie = p => /goal|שוער/i.test(p?.position || "")

/** Axes, in radar order (clockwise from the top). Goalies swap the scoring axis for defence. */
export function axesFor(player) {
  return [
    isGoalie(player) ? { key: "def", label: "הגנה" } : { key: "gol", label: "שערים" },
    { key: "frm", label: "כושר" },
    { key: "imp", label: "השפעה" },
    { key: "win", label: "ניצחון" },
    { key: "dis", label: "משמעת" },
    { key: "exp", label: "ניסיון" },
  ]
}

const WEIGHTS = { gol: 0.25, def: 0.25, frm: 0.15, imp: 0.15, win: 0.2, dis: 0.1, exp: 0.15 }

const played = g => g && g.home_score != null && g.away_score != null && !g.is_test

/** Per-player raw totals over all seasons. `players` = { id → { team_id, position } }. */
export function aggregate({ games, stats, players, currentSeasonId }) {
  const gameById = new Map(games.filter(played).map(g => [g.id, g]))
  const out = new Map()
  for (const s of stats) {
    if (!s.player_id || s.is_guest_player) continue
    const g = gameById.get(s.game_id)
    if (!g) continue
    const a = out.get(s.player_id) || { gp: 0, goals: 0, cards: 0, sgp: 0, sgoals: 0, tgp: 0, wins: 0, teamGoals: 0, conceded: 0, cs: 0 }
    a.gp++
    a.goals += s.goals || 0
    a.cards += (s.blue_cards || 0) + (s.yellow_cards || 0) + 2 * (s.red_cards || 0)
    if (s.clean_sheet) a.cs++
    if (g.season_id === currentSeasonId) { a.sgp++; a.sgoals += s.goals || 0 }
    const pTeam = players[s.player_id]?.team_id
    const team = s.played_for_team_id
      || (pTeam === g.home_team_id || pTeam === g.away_team_id ? pTeam : null)
    if (team) {
      const home = team === g.home_team_id
      const mine = home ? g.home_score : g.away_score
      const theirs = home ? g.away_score : g.home_score
      a.tgp++
      a.wins += mine > theirs ? 1 : mine === theirs ? 0.5 : 0
      a.teamGoals += mine
      a.conceded += theirs
    }
    out.set(s.player_id, a)
  }
  return out
}

const metrics = a => ({
  gol: a.gp ? a.goals / a.gp : 0,
  def: a.tgp ? -a.conceded / a.tgp : -99,
  frm: a.sgp ? a.sgoals / a.sgp : -1,
  imp: a.teamGoals ? a.goals / a.teamGoals : 0,
  win: a.tgp ? a.wins / a.tgp : 0,
  dis: a.gp ? -a.cards / a.gp : 0,
  exp: a.gp,
})

/** Share of `pool` below v, ties counted half — 0..1. `tiesUp`: ties count in full, so a
 *  clean record that most of the league shares (0 cards) still reads as top discipline. */
function pct(pool, v, tiesUp = false) {
  if (!pool.length) return 0.5
  let below = 0, eq = 0
  for (const x of pool) { if (x < v) below++; else if (x === v) eq++ }
  return (below + (tiesUp ? eq : eq / 2)) / pool.length
}

const scale = p => Math.round(45 + 54 * p)

/** The card for one player id, or null when he has no completed games on record. */
export function playerCard(playerId, { totals, players }) {
  const a = totals.get(playerId)
  const me = players[playerId]
  if (!a || !me) return null
  const goalie = isGoalie(me)
  const peers = [...totals.entries()]
    .filter(([id, t]) => t.gp >= MIN_GP && isGoalie(players[id]) === goalie)
    .map(([, t]) => metrics(t))
  const mine = metrics(a)
  const axes = axesFor(me).map(ax => {
    let v = scale(pct(peers.map(m => m[ax.key]), mine[ax.key], ax.key === "dis"))
    if (ax.key === "frm" && !a.sgp) v = 45 // no game yet this season
    return { ...ax, value: v }
  })
  const wsum = axes.reduce((s, ax) => s + WEIGHTS[ax.key], 0)
  const ovr = Math.round(axes.reduce((s, ax) => s + ax.value * WEIGHTS[ax.key], 0) / wsum)
  return {
    ovr,
    axes,
    goalie,
    raw: { gp: a.gp, goals: a.goals, cards: a.cards, cs: a.cs, seasonGoals: a.sgoals, seasonGp: a.sgp },
  }
}
