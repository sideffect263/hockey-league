/**
 * EA FC-style player card numbers, from real league data only: completed league games of every
 * season and their judge sheets (season_games / season_game_stats RPCs)
 * and real follower counts (follower_counts RPC — the team's own roster doesn't count).
 *
 * Five axes, each SHOWN as a score on a soft curve: 30 = nothing, 92 = the best in his position
 * group, so nobody shows 99 (Ariel 2026-11-12). How the score is made and how OVR is made is
 * documented on playerCard() below.
 *   השפעה  — (goals) goals he scored THIS season
 *            (goalkeepers: goals his team CONCEDED per game in the games he played THIS season —
 *            fewer = better, needs MIN_GP games. Ariel 2026-11-11, knowingly close to הגנה
 *            (which is the same average over all seasons); it was clean sheets before)
 *   ניסיון — games he played (on the judge sheet), all seasons
 *   התקפה / הגנה — half his TEAM's level, half HIMSELF (Ariel 2026-11-12: "it shows who is on the
 *            better team, not who is better"):
 *            team part = his team's goals scored (conceded) in his games, against what that
 *            opponent usually concedes (scores) that season — opponent-adjusted;
 *            personal part = the same, in games he played minus games his team played WITHOUT
 *            him (same team, same season), trusted less when he missed few games.
 *            Both parts as z-scores in his position group, blended 50/50, then best = full point.
 *   הערצה  — (fans) people following him
 */
/** Games (all seasons) needed before attack / defence and a rating — one 10–3 win is luck. */
export const MIN_GP = 3
export const FANS_FLOOR = 10

const isGoalie = p => /goal|שוער/i.test(p?.position || "")

const AXES = [ // radar order: top, then clockwise
  { key: "goals", label: "השפעה" }, // order set by Ariel 2026-11-12: השפעה on top,
  { key: "att", label: "התקפה" },
  { key: "exp", label: "ניסיון" },   // ניסיון bottom right,
  { key: "fans", label: "הערצה" },
  { key: "def", label: "הגנה" },     // הגנה top left
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
  const on = new Map() // "season|team" → playerId → Set(gameId) — who played which of the team's games
  for (const s of stats) {
    if (!s.player_id || s.is_guest_player) continue
    const g = gameById.get(s.game_id)
    if (!g) continue
    const a = out.get(s.player_id) || { gp: 0, goals: 0, sgoals: 0, scs: 0, tgp: 0, scored: 0, conceded: 0, stgp: 0, sconceded: 0 }
    a.gp++
    a.goals += s.goals || 0
    if (g.season_id === currentSeasonId) a.sgoals += s.goals || 0
    const inGame = t => (t && (t === g.home_team_id || t === g.away_team_id) ? t : null)
    const team = inGame(s.played_for_team_id)
      || inGame(seasonTeams[g.season_id]?.[s.player_id])
      || inGame(players[s.player_id]?.team_id)
    if (team) {
      const k = `${g.season_id}|${team}`
      if (!on.has(k)) on.set(k, new Map())
      const byP = on.get(k)
      if (!byP.has(s.player_id)) byP.set(s.player_id, new Set())
      byP.get(s.player_id).add(g.id)
      const home = team === g.home_team_id
      a.tgp++
      a.scored += home ? g.home_score : g.away_score
      a.conceded += home ? g.away_score : g.home_score
      if ((home ? g.away_score : g.home_score) === 0) a.scs++ // clean sheet, any season
      if (g.season_id === currentSeasonId) { a.stgp++; a.sconceded += home ? g.away_score : g.home_score }
    }
    out.set(s.player_id, a)
  }
  teamAdjusted(gameById, on, out)
  return out
}

/** Games without him only count for so much: a difference from 1–2 missed games is mostly luck. */
const WITHOUT_TRUST = 4
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

/**
 * Adds to each player's totals: tAtt / tDef (his team's opponent-adjusted level in his games)
 * and wAtt / wDef (how much better the team did with him than without him).
 * Opponent-adjusted = goals scored minus what that opponent concedes on average that season
 * (attack); what the opponent scores on average minus goals conceded (defence) — the
 * opponent's average leaves this game out.
 */
function teamAdjusted(gameById, on, out) {
  const tg = new Map() // "season|team" → [{ gid, season, opp, s, c }]
  for (const g of gameById.values()) {
    for (const [t, o, sc, co] of [[g.home_team_id, g.away_team_id, g.home_score, g.away_score], [g.away_team_id, g.home_team_id, g.away_score, g.home_score]]) {
      const k = `${g.season_id}|${t}`
      if (!tg.has(k)) tg.set(k, [])
      tg.get(k).push({ gid: g.id, season: g.season_id, opp: o, s: sc, c: co })
    }
  }
  const oppAvg = (x, key) => {
    const rows = (tg.get(`${x.season}|${x.opp}`) || []).filter(r => r.gid !== x.gid)
    return rows.length ? mean(rows.map(r => r[key])) : null
  }
  for (const list of tg.values()) for (const x of list) {
    const oc = oppAvg(x, "c"), os = oppAvg(x, "s")
    x.as = oc == null ? 0 : x.s - oc
    x.ad = os == null ? 0 : os - x.c
  }
  const acc = new Map()
  for (const [k, byP] of on) {
    const all = tg.get(k) || []
    for (const [pid, set] of byP) {
      const w = all.filter(x => set.has(x.gid)), wo = all.filter(x => !set.has(x.gid))
      const r = acc.get(pid) || { ta: [], td: [], wa: 0, wd: 0, wn: 0 }
      for (const x of w) { r.ta.push(x.as); r.td.push(x.ad) }
      if (w.length && wo.length) {
        const trust = wo.length / (wo.length + WITHOUT_TRUST)
        r.wa += w.length * trust * (mean(w.map(x => x.as)) - mean(wo.map(x => x.as)))
        r.wd += w.length * trust * (mean(w.map(x => x.ad)) - mean(wo.map(x => x.ad)))
      }
      r.wn += w.length
      acc.set(pid, r)
    }
  }
  for (const [pid, r] of acc) {
    const a = out.get(pid)
    if (!a || !r.ta.length) continue
    a.tAtt = mean(r.ta); a.tDef = mean(r.td)
    a.wAtt = r.wa / Math.max(1, r.wn); a.wDef = r.wd / Math.max(1, r.wn)
  }
}

const raw = (a, fans, goalie) => ({
  goals: goalie ? (a.stgp ? a.sconceded / a.stgp : null) : a.sgoals, // keeper: goals conceded per game, THIS season
  exp: a.gp,
  att: a.tgp ? a.scored / a.tgp : null,
  def: a.tgp ? a.conceded / a.tgp : null,
  fans: fans || 0,
})

const fmt = (key, v, goalie) => v == null ? "–" : key === "att" || key === "def" || (goalie && key === "goals") ? v.toFixed(1) : String(v)

/** Axes that need the minimum games before they mean anything (one 10–3 win is luck). */
const NEEDS_GAMES = new Set(["att", "def"])
/** A keeper's השפעה is goals conceded: fewer = better, and like defence it needs the minimum games. */
const lowerIsBetter = (key, goalie) => goalie && key === "goals"
/** Attack / defence: share of the PERSONAL (with / without him) part; the rest is his team's level. */
export const PERSONAL_SHARE = 0.5
/** The shown score: 30 = nothing, 92 = the best in the group. Nobody shows 99. */
export const SCORE_MIN = 30, SCORE_MAX = 92
const toScore = p => (p == null ? null : Math.round(SCORE_MIN + (SCORE_MAX - SCORE_MIN) * p))
/** OVR scale: 40 with nothing, 92 with the best in everything. */
export const OVR_MIN = 40, OVR_MAX = 92

const groupCache = new WeakMap()
/** Attack / defence for a position group: z-score both parts, blend, best = 1, worst = 0. */
function adjustedPcts(totals, players, goalie) {
  let byGroup = groupCache.get(totals)
  if (!byGroup) { byGroup = new Map(); groupCache.set(totals, byGroup) }
  if (byGroup.has(goalie)) return byGroup.get(goalie)
  const pool = [...totals.entries()].filter(([id, t]) => isGoalie(players[id]) === goalie && t.gp >= MIN_GP && t.tAtt != null)
  const z = key => {
    const v = pool.map(([, t]) => t[key]), m = mean(v)
    const sd = Math.sqrt(mean(v.map(x => (x - m) ** 2))) || 1
    return new Map(pool.map(([id, t]) => [id, (t[key] - m) / sd]))
  }
  const res = new Map()
  for (const [axis, w, t] of [["att", "wAtt", "tAtt"], ["def", "wDef", "tDef"]]) {
    const zw = z(w), zt = z(t)
    const blend = new Map(pool.map(([id]) => [id, PERSONAL_SHARE * zw.get(id) + (1 - PERSONAL_SHARE) * zt.get(id)]))
    const v = [...blend.values()], lo = Math.min(...v), hi = Math.max(...v)
    for (const [id, b] of blend) {
      if (!res.has(id)) res.set(id, {})
      res.get(id)[axis] = hi > lo ? (b - lo) / (hi - lo) : 1
    }
  }
  byGroup.set(goalie, res)
  return res
}
const needsGames = (key, goalie) => NEEDS_GAMES.has(key) || (goalie && key === "goals")
/** Weights in the rating. Fans count, but only a little: they're popularity, not play. */
export const WEIGHTS = { goals: 0.30, exp: 0.15, att: 0.25, def: 0.25, fans: 0.05 } // Ariel 2026-11-11

/**
 * The card for one player id, or null when he has no completed games on record.
 * `fans` = { id → follower count }.
 *
 * ONE rule for every point: compared with the best in his position group (field players vs
 * goalkeepers). The best gets a full point, everyone else his share of it — so
 * "1 goal, the best has 10" draws at 10%. Attack / defence: see adjustedPcts (best = 1, worst = 0).
 * Fans are out of at least FANS_FLOOR, so 1 fan stays small while the league has few.
 * Attack / defence (and so the rating) need MIN_GP games; below that they show "–" and the
 * card has no OVR yet. OVR = the five points weighted by WEIGHTS (fans 5%), on a 40–92 scale.
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
    if (ax.key === "att" || ax.key === "def") {
      best = pool.length ? (ax.key === "def" ? Math.min(...pool) : Math.max(...pool)) : null
      p = v == null ? null : adjustedPcts(totals, players, goalie).get(playerId)?.[ax.key] ?? null
    } else if (lowerIsBetter(ax.key, goalie)) {
      best = pool.length ? Math.min(...pool) : null
      p = v == null || best == null ? null : v <= best ? 1 : best / v
    } else {
      best = Math.max(ax.key === "fans" ? FANS_FLOOR : 0, ...pool)
      p = v == null ? null : best > 0 ? Math.min(1, v / best) : 0
    }
    // Every axis is SHOWN as a score on the soft curve (toScore), so a bigger number is always a
    // bigger point. The real figure stays as `value` / `raw` (defence also `conceded`).
    const score = toScore(p)
    return { ...ax, value: v, raw: fmt(ax.key, v, goalie), score, shown: score == null ? "–" : String(score), pct: p, best, bestShown: fmt(ax.key, best, goalie),
      ...(ax.key === "def" ? { conceded: v } : {}) }
  })
  // A keeper who hasn't played this season has no השפעה ("–"); it counts as 0 in the rating
  // instead of taking his whole rating away.
  const pctFor = ax => (goalie && ax.key === "goals" ? ax.pct ?? 0 : ax.pct)
  const ovr = enough && axes.every(ax => pctFor(ax) != null)
    ? Math.round(OVR_MIN + (OVR_MAX - OVR_MIN) * axes.reduce((s, ax) => s + pctFor(ax) * WEIGHTS[ax.key], 0))
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
