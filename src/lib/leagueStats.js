/**
 * League-wide statistical derivations for the Statistics page.
 *
 * Every export here is a PURE, side-effect-free function of its arguments so it
 * can be unit-tested in isolation. No React, no fetching, no globals.
 *
 * DATA CAVEATS baked into these functions (verified against production):
 *  - Team-level series (goals over time, goal race, goal difference) are sourced
 *    from the `games` table, because ALL 45 completed games carry scores there.
 *  - Player-level series (hat-tricks, braces, big games) come from `game_stats`,
 *    which only exists for 40 of the 45 completed games — the other 5 never will.
 *    Anything derived from game_stats must be presented with that "40 מתוך 45"
 *    caveat in the UI. Season *totals* per player still live on players.goals and
 *    are authoritative; we never recompute those here.
 *  - `game_date` is a timestamptz STRING like "2025-09-27 13:30:00+00". We slice
 *    the month/date straight off the string rather than going through `Date`, so
 *    our month buckets line up with the DB's UTC `::date` grouping and never
 *    drift with the viewer's local timezone.
 *  - April 2026 has ZERO games — a real mid-season gap. `seasonMonths` emits it
 *    so the timeline renders it as an empty month instead of silently closing up.
 *  - game_stats.clean_sheet is all-false in prod and yellow_cards is unused —
 *    never read them. Clean sheets are derived from game scores.
 */

/**
 * The "friendly" (ידידותי) game type. Friendly games are content-only: they
 * appear in the feed, run live, and show on the judge list, but they are NEVER
 * counted toward the competitive record — not standings, not player/team totals,
 * not any chart or award on the Statistics page. The DB mirror of this rule is
 * `recompute_team_standings`, which excludes the same type server-side.
 */
export const FRIENDLY_GAME_TYPE = 'ידידותי'

/** True for games that count toward standings and all aggregate statistics.
 *  Friendlies never count; neither do youth-TOURNAMENT games (tournament_id set)
 *  — those belong to their own competition, not the senior league. */
export const countsForStats = (g) => g?.game_type !== FRIENDLY_GAME_TYPE && !g?.tournament_id

const HE_MONTHS_SHORT = [
  'ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני',
  'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳',
]

const isCompleted = (g) => g?.status === 'completed'
const gameTotal = (g) => (g.home_score || 0) + (g.away_score || 0)

/** 'YYYY-MM' bucket key, sliced off the raw timestamptz string (timezone-safe). */
export function monthKeyOf(dateStr) {
  return typeof dateStr === 'string' ? dateStr.slice(0, 7) : ''
}

/** Milliseconds for a timestamptz string, normalised for Safari ("+00" → "+00:00"). */
export function dateMs(dateStr) {
  if (typeof dateStr !== 'string') return NaN
  const iso = dateStr.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  return new Date(iso).getTime()
}

/** UTC-midnight ms of the first of a 'YYYY-MM' month (for x-axis month ticks). */
export function monthStartMs(key) {
  const [y, m] = key.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, 1)
}

/** 'ספט׳ 25' — short Hebrew month + 2-digit year. */
export function monthLabel(key) {
  const [y, m] = key.split('-')
  const idx = parseInt(m, 10) - 1
  return `${HE_MONTHS_SHORT[idx] || m} ${y.slice(2)}`
}

/** Compact axis label: bare short month, but tag the year on each January. */
export function shortMonthLabel(key) {
  const [y, m] = key.split('-')
  const idx = parseInt(m, 10) - 1
  const short = HE_MONTHS_SHORT[idx] || m
  return idx === 0 ? `${short} ${y.slice(2)}` : short
}

/**
 * Ordered 'YYYY-MM' keys spanning the earliest → latest COMPLETED game,
 * INCLUDING months with no games (i.e. April 2026). This is what makes the
 * timeline honest about the mid-season gap.
 */
export function seasonMonths(games = []) {
  const keys = games.filter(isCompleted).map((g) => monthKeyOf(g.game_date)).filter(Boolean)
  if (keys.length === 0) return []
  const min = keys.reduce((a, b) => (a < b ? a : b))
  const max = keys.reduce((a, b) => (a > b ? a : b))
  let [y, m] = min.split('-').map(Number)
  const [ey, em] = max.split('-').map(Number)
  const out = []
  // Guard against a malformed range spinning forever.
  let guard = 0
  while ((y < ey || (y === ey && m <= em)) && guard++ < 240) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/**
 * League goals per month across the season range.
 * → [{ month, label, games, goals, avg }] — zero-game months (April) included.
 * Sourced from `games` (complete). Totals to 465 goals across 45 games.
 */
export function monthlyGoals(games = []) {
  const months = seasonMonths(games)
  const acc = {}
  games.filter(isCompleted).forEach((g) => {
    const k = monthKeyOf(g.game_date)
    if (!k) return
    if (!acc[k]) acc[k] = { games: 0, goals: 0 }
    acc[k].games += 1
    acc[k].goals += gameTotal(g)
  })
  return months.map((month) => {
    const a = acc[month] || { games: 0, goals: 0 }
    return {
      month,
      label: monthLabel(month),
      games: a.games,
      goals: a.goals,
      avg: a.games ? a.goals / a.games : 0,
    }
  })
}

/**
 * The goal race: cumulative goals scored by each team over the season, in date
 * order. Sourced from `games`. Each series starts at (seasonStart, 0) so every
 * line rises from a shared baseline on the left.
 * → [{ teamId, name, team, total, points:[{x:ms, y:cumulative}] }]
 */
export function cumulativeTeamGoals(games = [], teams = []) {
  const done = games
    .filter(isCompleted)
    .filter((g) => g.game_date)
    .slice()
    .sort((a, b) => (a.game_date < b.game_date ? -1 : a.game_date > b.game_date ? 1 : 0))
  if (done.length === 0) return []
  const startMs = dateMs(done[0].game_date)
  return teams.map((team) => {
    let cum = 0
    const points = [{ x: startMs, y: 0 }]
    done.forEach((g) => {
      let scored = null
      if (g.home_team_id === team.id) scored = g.home_score || 0
      else if (g.away_team_id === team.id) scored = g.away_score || 0
      if (scored != null) {
        cum += scored
        points.push({ x: dateMs(g.game_date), y: cum })
      }
    })
    return { teamId: team.id, name: team.name, team, total: cum, points }
  })
}

/**
 * The goal race, per PLAYER: cumulative goals each player scored over the season,
 * in date order. Sourced from `game_stats` (40 of 45 games — caller must show the
 * caveat), joined to game dates. Each series starts at (seasonStart, 0) so every
 * line rises from a shared baseline, exactly like cumulativeTeamGoals.
 * → [{ playerId, name, first_name, last_name, team_id, total, points:[{x,y}] }]
 *   sorted by total desc (caller slices the top N).
 */
export function cumulativePlayerGoals(gameStats = [], games = [], players = []) {
  const byId = new Map(players.map((p) => [p.id, p]))
  const done = games
    .filter(isCompleted)
    .filter((g) => g.game_date)
    .slice()
    .sort((a, b) => (a.game_date < b.game_date ? -1 : a.game_date > b.game_date ? 1 : 0))
  if (done.length === 0) return []
  const startMs = dateMs(done[0].game_date)
  const dateOf = new Map()
  done.forEach((g) => dateOf.set(g.id, g.game_date))

  // Sum goals per (player, game) first — defensive against duplicate stat rows.
  const perPG = new Map()
  gameStats.forEach((s) => {
    if (!s.player_id || !byId.has(s.player_id)) return
    const d = dateOf.get(s.game_id)
    if (!d) return
    const key = `${s.player_id}|${s.game_id}`
    if (!perPG.has(key)) perPG.set(key, { pid: s.player_id, ms: dateMs(d), goals: 0 })
    perPG.get(key).goals += s.goals || 0
  })

  const events = new Map()
  perPG.forEach((e) => {
    if (e.goals <= 0) return
    if (!events.has(e.pid)) events.set(e.pid, [])
    events.get(e.pid).push({ ms: e.ms, goals: e.goals })
  })

  const series = []
  events.forEach((evs, pid) => {
    const p = byId.get(pid)
    evs.sort((a, b) => a.ms - b.ms)
    let cum = 0
    const points = [{ x: startMs, y: 0 }]
    evs.forEach((e) => { cum += e.goals; points.push({ x: e.ms, y: cum }) })
    series.push({
      playerId: pid,
      name: `${p.first_name} ${p.last_name}`,
      first_name: p.first_name,
      last_name: p.last_name,
      team_id: p.team_id,
      total: cum,
      points,
    })
  })
  return series.sort((a, b) => b.total - a.total)
}

/**
 * Braces / hat-tricks / big games aggregated per TEAM, from `game_stats` joined
 * to each scorer's team (40 of 45 games — caller must show the caveat).
 * → [{ teamId, name, team, braces, hatTricks, bigGames }] sorted by hatTricks desc.
 */
export function teamAchievements(gameStats = [], players = [], teams = []) {
  const teamOf = new Map(players.map((p) => [p.id, p.team_id]))
  const agg = new Map(
    teams.map((t) => [t.id, { teamId: t.id, name: t.name, team: t, braces: 0, hatTricks: 0, bigGames: 0 }])
  )
  gameStats.forEach((s) => {
    if (!s.player_id) return
    const tid = s.played_for_team_id || teamOf.get(s.player_id)   // a loaned player counts for the side he played for
    if (tid == null || !agg.has(tid)) return
    const goals = s.goals || 0
    if (goals === 2) agg.get(tid).braces += 1
    else if (goals >= 3) agg.get(tid).hatTricks += 1
    if (goals >= 5) agg.get(tid).bigGames += 1
  })
  return Array.from(agg.values()).sort((a, b) => b.hatTricks - a.hatTricks || b.bigGames - a.bigGames)
}

/**
 * Goal difference per team, sourced from `games` (complete).
 * → [{ teamId, name, team, gf, ga, gd }] sorted by gd desc.
 */
export function teamGoalDiff(games = [], teams = []) {
  const done = games.filter(isCompleted)
  return teams
    .map((team) => {
      let gf = 0
      let ga = 0
      done.forEach((g) => {
        if (g.home_team_id === team.id) { gf += g.home_score || 0; ga += g.away_score || 0 }
        else if (g.away_team_id === team.id) { gf += g.away_score || 0; ga += g.home_score || 0 }
      })
      return { teamId: team.id, name: team.name, team, gf, ga, gd: gf - ga }
    })
    .sort((a, b) => b.gd - a.gd)
}

/**
 * Per-player achievements from `game_stats` (40 of 45 games — caller must show
 * the caveat). Guest rows (null player_id) have no player page and are skipped.
 *  - brace     = exactly 2 goals in a game
 *  - hatTrick  = 3+ goals in a game (a 5+ game counts here too)
 *  - bigGame   = 5+ goals in a game (a SUBSET of hatTricks — the extra highlight)
 * → { players:[{ id, first_name, last_name, team_id, hatTricks, bigGames,
 *                braces, gamesWithGoal }], totals:{ hatTricks, bigGames, braces } }
 */
export function playerAchievements(gameStats = [], players = []) {
  const byId = new Map(players.map((p) => [p.id, p]))
  const agg = new Map()
  const totals = { hatTricks: 0, bigGames: 0, braces: 0 }
  gameStats.forEach((s) => {
    if (!s.player_id || !byId.has(s.player_id)) return
    const goals = s.goals || 0
    if (!agg.has(s.player_id)) {
      agg.set(s.player_id, { id: s.player_id, hatTricks: 0, bigGames: 0, braces: 0, gamesWithGoal: 0 })
    }
    const a = agg.get(s.player_id)
    if (goals >= 1) a.gamesWithGoal += 1
    if (goals === 2) { a.braces += 1; totals.braces += 1 }
    else if (goals >= 3) { a.hatTricks += 1; totals.hatTricks += 1 }
    // A 5+ game IS a hat-trick (counted above) AND is additionally flagged as a
    // "fire game" / משחקי-על — the two are no longer mutually exclusive.
    if (goals >= 5) { a.bigGames += 1; totals.bigGames += 1 }
  })
  const list = Array.from(agg.values()).map((a) => {
    const p = byId.get(a.id)
    return { ...a, first_name: p.first_name, last_name: p.last_name, team_id: p.team_id }
  })
  return { players: list, totals }
}

/**
 * Hat-tricks / big games per season month, from `game_stats` joined to game
 * dates. Zero-filled over the season range (April included).
 * → [{ month, label, hatTricks, bigGames }]
 */
export function achievementsOverTime(gameStats = [], games = []) {
  const months = seasonMonths(games)
  const gameMonth = new Map()
  games.forEach((g) => { if (g.game_date) gameMonth.set(g.id, monthKeyOf(g.game_date)) })
  const acc = {}
  months.forEach((m) => { acc[m] = { hatTricks: 0, bigGames: 0 } })
  gameStats.forEach((s) => {
    const m = gameMonth.get(s.game_id)
    if (!m || !acc[m]) return
    const goals = s.goals || 0
    if (goals >= 3) acc[m].hatTricks += 1
    if (goals >= 5) acc[m].bigGames += 1
  })
  return months.map((m) => ({ month: m, label: monthLabel(m), ...acc[m] }))
}

/**
 * Goalkeeper clean sheets — the canonical Statistics.jsx computation, lifted to
 * a pure function. A clean sheet is a COMPLETED game where the keeper's team
 * held the opponent to 0 (derived from scores; game_stats.clean_sheet is unused).
 * → [{ ...gk, clean_sheets, total_games }] sorted by clean_sheets desc.
 */
export function goalkeeperCleanSheets(players = [], games = []) {
  const done = games.filter(isCompleted)
  return players
    .filter((p) => p.position === 'Goalkeeper')
    .map((gk) => {
      const tg = done.filter((g) => g.home_team_id === gk.team_id || g.away_team_id === gk.team_id)
      const cs = tg.filter((g) => (g.home_team_id === gk.team_id ? g.away_score : g.home_score) === 0).length
      return { ...gk, clean_sheets: cs, total_games: tg.length }
    })
    .sort((a, b) => b.clean_sheets - a.clean_sheets)
}

/**
 * Headline league numbers from `games` (complete).
 * → { completedGames, totalGoals, avgPerGame, shutouts, highestScoringGame,
 *     highestTotal }
 * shutouts = games where at least one side was kept scoreless (5 in prod).
 * highestScoringGame is the full game row so the UI can link it to /games/:id.
 */
export function leagueSummary(games = []) {
  const done = games.filter(isCompleted)
  const totalGoals = done.reduce((s, g) => s + gameTotal(g), 0)
  const shutouts = done.filter((g) => (g.home_score || 0) === 0 || (g.away_score || 0) === 0).length
  let highestScoringGame = null
  let highestTotal = -1
  done.forEach((g) => {
    const t = gameTotal(g)
    if (t > highestTotal) { highestTotal = t; highestScoringGame = g }
  })
  return {
    completedGames: done.length,
    totalGoals,
    avgPerGame: done.length ? totalGoals / done.length : 0,
    shutouts,
    highestScoringGame,
    highestTotal: highestTotal < 0 ? 0 : highestTotal,
  }
}
