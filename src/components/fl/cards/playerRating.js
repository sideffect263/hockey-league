/**
 * EA FC-style player card numbers, from real league data only: completed league games of every
 * season and their judge sheets (season_games / season_game_stats RPCs)
 * and real follower counts (follower_counts RPC — the team's own roster doesn't count).
 *
 * Five axes, each shown as its REAL value; how the shape is drawn and how OVR is made is
 * documented on playerCard() below.
 *   שערים  — goals he scored THIS season
 *            (goalkeepers: שערים נקיים — THIS season's games he was on the sheet and his team
 *            conceded 0; the sheets' clean_sheet flag is never set, so it's worked out from the score)
 *   ניסיון — games he played (on the judge sheet), all seasons
 *   התקפה  — average goals HIS team scored in the games he played
 *   הגנה   — average goals his team CONCEDED in the games he played (fewer = better)
 *   אוהדים — people following him
 */
/** Games (all seasons) needed before attack / defence and a rating — one 10–3 win is luck. */
export const MIN_GP = 3
export const FANS_FLOOR = 10

const isGoalie = p => /goal|שוער/i.test(p?.position || "")

const AXES = [ // radar order: top, then clockwise
  { key: "exp", label: "ניסיון" },
  { key: "att", label: "התקפה" },
  { key: "def", label: "הגנה" },
  { key: "fans", label: "אוהדים" },
  { key: "goals", label: "שערים" },
]
/** A goalkeeper's "goals" point is clean sheets — same key, so weights and layout stay put. */
const axesFor = goalie => goalie ? AXES.map(ax => ax.key === "goals" ? { ...ax, label: "שערים נקיים" } : ax) : AXES

// Same games the league table counts (recompute_player_season_stats): scored, not a test,
// not a friendly, not a tournament.
const played = g => g && g.home_score != null && g.away_score != null && !g.is_test
  && g.game_type !== "ידידותי" && !g.tournament_id

/** Per-player raw totals over every season; goals only from `currentSeasonId`.
 *  `players` = { id → { team_id, position } }.
 *  `seasonTeams` = { seasonId → { playerId → team_id } }: the team he was on THAT season
 *  (player_season_stats, frozen at season close). Without it a player who changed teams
 *  had last season's games dropped, or credited to the side he played against. */
export function aggregate({ games, stats, players, currentSeasonId, seasonTeams = {} }) {
  const gameById = new Map(games.filter(played).map(g => [g.id, g]))
  const out = new Map()
  for (const s of stats) {
    if (!s.player_id || s.is_guest_player) continue
    const g = gameById.get(s.game_id)
    if (!g) continue
    const a = out.get(s.player_id) || { gp: 0, goals: 0, sgoals: 0, scs: 0, tgp: 0, scored: 0, conceded: 0 }
    a.gp++
    a.goals += s.goals || 0
    if (g.season_id === currentSeasonId) a.sgoals += s.goals || 0
    const inGame = t => (t && (t === g.home_team_id || t === g.away_team_id) ? t : null)
    const team = inGame(s.played_for_team_id)
      || inGame(seasonTeams[g.season_id]?.[s.player_id])
      || inGame(players[s.player_id]?.team_id)
    if (team) {
      const home = team === g.home_team_id
      a.tgp++
      a.scored += home ? g.home_score : g.away_score
      a.conceded += home ? g.away_score : g.home_score
      if (g.season_id === currentSeasonId && (home ? g.away_score : g.home_score) === 0) a.scs++
    }
    out.set(s.player_id, a)
  }
  return out
}

const raw = (a, fans, goalie) => ({
  goals: goalie ? a.scs : a.sgoals,
  exp: a.gp,
  att: a.tgp ? a.scored / a.tgp : null,
  def: a.tgp ? a.conceded / a.tgp : null,
  fans: fans || 0,
})

const fmt = (key, v) => v == null ? "–" : key === "att" || key === "def" ? v.toFixed(1) : String(v)

/** Axes that need the minimum games before they mean anything (one 10–3 win is luck). */
const NEEDS_GAMES = new Set(["att", "def"])
/** Weights in the rating. Fans count, but only a little: they're popularity, not play. */
export const WEIGHTS = { goals: 0.2375, exp: 0.2375, att: 0.2375, def: 0.2375, fans: 0.05 }

/**
 * The card for one player id, or null when he has no completed games on record.
 * `fans` = { id → follower count }.
 *
 * ONE rule for every point: compared with the best in his position group (field players vs
 * goalkeepers). The best gets a full point, everyone else his share of it — so
 * "1 goal, the best has 10" draws at 10%. Defence: fewest goals conceded is best (best / his).
 * Fans are out of at least FANS_FLOOR, so 1 fan stays small while the league has few.
 * Attack / defence (and so the rating) need MIN_GP games; below that they show "–" and the
 * card has no OVR yet. OVR = the five points weighted by WEIGHTS (fans 5%), on a 40–99 scale.
 */
export function playerCard(playerId, { totals, players, fans = {} }) {
  const a = totals.get(playerId)
  const me = players[playerId]
  if (!a || !me) return null
  const goalie = isGoalie(me)
  const group = [...totals.entries()].filter(([id]) => isGoalie(players[id]) === goalie)
  const minGames = MIN_GP
  const enough = a.gp >= minGames
  const mine = raw(a, fans[playerId], goalie)
  const axes = axesFor(goalie).map(ax => {
    const pool = group
      .filter(([, t]) => !NEEDS_GAMES.has(ax.key) || t.gp >= minGames)
      .map(([id, t]) => raw(t, fans[id], goalie)[ax.key])
      .filter(v => v != null)
    const v = NEEDS_GAMES.has(ax.key) && !enough ? null : mine[ax.key]
    let best, p
    if (ax.key === "def") {
      best = pool.length ? Math.min(...pool) : null
      p = v == null || best == null ? null : v <= best ? 1 : best / v
    } else {
      best = Math.max(ax.key === "fans" ? FANS_FLOOR : 0, ...pool)
      p = v == null ? null : best > 0 ? Math.min(1, v / best) : 0
    }
    return { ...ax, value: v, shown: fmt(ax.key, v), pct: p, best, bestShown: fmt(ax.key, best) }
  })
  const ovr = enough && axes.every(ax => ax.pct != null)
    ? Math.round(40 + 59 * axes.reduce((s, ax) => s + ax.pct * WEIGHTS[ax.key], 0))
    : null
  return { ovr, axes, goalie, gp: a.gp, minGames }
}
