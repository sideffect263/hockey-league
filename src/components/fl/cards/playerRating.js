/**
 * EA FC-style player card numbers, from real league data only: completed league games of every
 * season and their judge sheets (season_games / season_game_stats RPCs)
 * and real follower counts (follower_counts RPC — the team's own roster doesn't count).
 *
 * Five axes, each SHOWN as a 0–99 score against the best in the group (99 = the best), built
 * from these real figures; how the score is made and how OVR is made is
 * documented on playerCard() below.
 *   השפעה  — (goals) goals he scored THIS season
 *            (goalkeepers: goals his team CONCEDED in total in the games he played, all seasons —
 *            fewer = better, needs MIN_GP games. Ariel 2026-11-11; it was clean sheets before)
 *   ניסיון — games he played (on the judge sheet), all seasons
 *   התקפה  — average goals HIS team scored in the games he played
 *   הגנה   — average goals his team CONCEDED in the games he played (fewer = better, so its
 *            score is 99 × fewest-in-group / his)
 *   הערצה  — (fans) people following him
 */
/** Games (all seasons) needed before attack / defence and a rating — one 10–3 win is luck. */
export const MIN_GP = 3
export const FANS_FLOOR = 10

const isGoalie = p => /goal|שוער/i.test(p?.position || "")

const AXES = [ // radar order: top, then clockwise
  { key: "exp", label: "ניסיון" },
  { key: "att", label: "התקפה" },
  { key: "def", label: "הגנה" },
  { key: "fans", label: "הערצה" },
  { key: "goals", label: "השפעה" },
]
/** Same labels for everyone: a goalkeeper's השפעה is clean sheets instead of goals (see raw()). */
const axesFor = () => AXES

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
      if ((home ? g.away_score : g.home_score) === 0) a.scs++ // clean sheet, any season
    }
    out.set(s.player_id, a)
  }
  return out
}

const raw = (a, fans, goalie) => ({
  goals: goalie ? (a.tgp ? a.conceded : null) : a.sgoals, // keeper: total goals his team let in with him on the sheet
  exp: a.gp,
  att: a.tgp ? a.scored / a.tgp : null,
  def: a.tgp ? a.conceded / a.tgp : null,
  fans: fans || 0,
})

const fmt = (key, v) => v == null ? "–" : key === "att" || key === "def" ? v.toFixed(1) : String(v)

/** Axes that need the minimum games before they mean anything (one 10–3 win is luck). */
const NEEDS_GAMES = new Set(["att", "def"])
/** A keeper's השפעה is goals conceded: fewer = better, and like defence it needs the minimum games. */
const lowerIsBetter = (key, goalie) => key === "def" || (goalie && key === "goals")
const needsGames = (key, goalie) => NEEDS_GAMES.has(key) || (goalie && key === "goals")
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
      .filter(([, t]) => !needsGames(ax.key, goalie) || t.gp >= minGames)
      .map(([id, t]) => raw(t, fans[id], goalie)[ax.key])
      .filter(v => v != null)
    const v = needsGames(ax.key, goalie) && !enough ? null : mine[ax.key]
    let best, p
    if (lowerIsBetter(ax.key, goalie)) {
      best = pool.length ? Math.min(...pool) : null
      p = v == null || best == null ? null : v <= best ? 1 : best / v
    } else {
      best = Math.max(ax.key === "fans" ? FANS_FLOOR : 0, ...pool)
      p = v == null ? null : best > 0 ? Math.min(1, v / best) : 0
    }
    // Every axis is SHOWN as a 0–99 score (99 = the best in the group), so a bigger number is
    // always a bigger point. The real figure stays as `value` / `raw` (defence also `conceded`).
    const score = p == null ? null : Math.round(99 * p)
    return { ...ax, value: v, raw: fmt(ax.key, v), score, shown: score == null ? "–" : String(score), pct: p, best, bestShown: fmt(ax.key, best),
      ...(ax.key === "def" ? { conceded: v } : {}) }
  })
  const ovr = enough && axes.every(ax => ax.pct != null)
    ? Math.round(40 + 59 * axes.reduce((s, ax) => s + ax.pct * WEIGHTS[ax.key], 0))
    : null
  return { ovr, axes, goalie, gp: a.gp, minGames }
}

/**
 * What changed in a player's last game: his card now vs the card the league gave him just
 * BEFORE that game (the whole league without that one game — other players' numbers move
 * the "best in group" too, exactly as they did on the day). Returns the game and the
 * differences: OVR and each axis score (0–99); null where either side has no number yet.
 * `cache` (Map) shares the "league without game X" totals between players of the same game.
 */
export function lastGameChange(playerId, { games, stats, players, fans = {}, currentSeasonId, seasonTeams = {}, totals }, cache = new Map()) {
  const counted = new Map(games.filter(played).map(g => [g.id, g]))
  let last = null
  for (const s of stats) {
    if (s.player_id !== playerId || s.is_guest_player) continue
    const g = counted.get(s.game_id)
    if (g && (!last || String(g.game_date || "") > String(last.game_date || ""))) last = g
  }
  if (!last) return null
  let before = cache.get(last.id)
  if (!before) {
    before = aggregate({ games: games.filter(g => g.id !== last.id), stats, players, currentSeasonId, seasonTeams })
    cache.set(last.id, before)
  }
  const now = playerCard(playerId, { totals: totals || aggregate({ games, stats, players, currentSeasonId, seasonTeams }), players, fans })
  const prev = playerCard(playerId, { totals: before, players, fans })
  if (!now) return null
  const diff = (a, b) => (a == null || b == null ? null : a - b)
  return {
    game: last,
    firstGame: !prev,
    ovr: diff(now.ovr, prev?.ovr),
    axes: Object.fromEntries(now.axes.map(ax => [ax.key, diff(ax.score, prev?.axes.find(p => p.key === ax.key)?.score)])),
  }
}
