// Pure: what a game_reports row says about fouls, timeouts, the half-time score and
// captains. Imported by api/game-form.js as well as the browser bundle (via
// lib/gameFormData.js) — keep it free of the Supabase client and of Vite-only imports.

const PERIOD_OF_HALF = { first: '1', second: '2', third: '3', ot1: 'הארכה 1', ot2: 'הארכה 2' }
// Android names the away side "guest"; the web engine does too inside its snapshot.
const sideOf = (s) => (s === 'home' ? 'home' : s === 'away' || s === 'guest' ? 'away' : null)

/**
 * Normalise either source into one event list: { type, side, period, timeMS }.
 * type ∈ goal | foul | timeout.
 */
function eventsFrom(row) {
  const snap = row?.final_state
  if (snap && Array.isArray(snap.strikes)) {
    const ev = []
    // An own goal's side is already the side it is credited to — it counts there.
    for (const g of snap.goals || []) ev.push({ type: 'goal', side: sideOf(g.side), period: PERIOD_OF_HALF[g.half] || '', timeMS: g.timeMS, ...(g.ownGoal ? { ownGoal: true } : {}) })
    for (const s of snap.strikes || []) ev.push({ type: 'foul', side: sideOf(s.side), period: PERIOD_OF_HALF[s.half] || '', timeMS: s.timeMS })
    for (const b of snap.breaks || []) {
      if (b.kind === 'homeTimeout' || b.kind === 'guestTimeout')
        ev.push({ type: 'timeout', side: b.kind === 'homeTimeout' ? 'home' : 'away', period: PERIOD_OF_HALF[b.half] || '', timeMS: b.timeMS })
    }
    return { events: ev, periodMS: snap.settings?.periodMS || null, exact: true }
  }
  const ev = (row?.events || []).map(e => ({ type: e.type, side: sideOf(e.side), period: e.period || '', timeMS: e.timeMS, ...(e.ownGoal ? { ownGoal: true } : {}) }))
  // Native boards report their half length on the save / broadcast (game_reports.period_ms).
  return { events: ev, periodMS: row?.period_ms || null, exact: false }
}

const DEFAULT_PERIOD_MS = 25 * 60_000

/**
 * What the form needs: total team fouls per side, each side's timeouts by half (as the
 * minute of the half they were called in), and the half-time score. `null` when the
 * game has no recorded report at all.
 */
export function summarizeReport(row) {
  return withPaperSheet(summarizeArchive(row), row)
}

const isNum = (v) => Number.isFinite(v)

/**
 * The paper form's numbers (game_reports.home_fouls … timeouts, entered from the photo of
 * the טופס שיפוט — see supabase/game-form-sheet.sql) win over anything derived from the
 * board's archive: the paper is what the referee signed. Each fact falls back separately.
 */
function withPaperSheet(derived, row) {
  const paperFouls = isNum(row?.home_fouls) || isNum(row?.away_fouls)
  const paperHalftime = isNum(row?.halftime_home) && isNum(row?.halftime_away)
  const paperTimeouts = !!row?.timeouts
  if (!paperFouls && !paperHalftime && !paperTimeouts) return derived
  const none = { first: [], second: [] }
  return {
    exact: derived?.exact ?? false,
    goals: derived?.goals ?? { home: 0, away: 0 },
    hasGoals: derived?.hasGoals ?? false,
    fouls: paperFouls ? { home: row.home_fouls ?? 0, away: row.away_fouls ?? 0 } : (derived?.fouls ?? null),
    timeouts: paperTimeouts
      ? { home: { ...none, ...row.timeouts.home }, away: { ...none, ...row.timeouts.away } }
      : (derived?.timeouts ?? null),
    hasTimeouts: paperTimeouts || !!derived?.hasTimeouts,
    halftime: paperHalftime ? { home: row.halftime_home, away: row.halftime_away } : (derived?.halftime ?? null),
    fromPaper: { fouls: paperFouls, halftime: paperHalftime, timeouts: paperTimeouts },
  }
}

function summarizeArchive(row) {
  if (!row || (!row.final_state && !(row.events || []).length)) return null
  const { events, periodMS, exact } = eventsFrom(row)
  const len = periodMS || DEFAULT_PERIOD_MS
  const count = (type, side, pred = () => true) => events.filter(e => e.type === type && e.side === side && pred(e)).length
  // Minute of the half, 1-based, from the clock's REMAINING time.
  const minute = (e) => (Number.isFinite(e.timeMS) ? Math.min(Math.floor((len - e.timeMS) / 60_000) + 1, Math.ceil(len / 60_000)) : null)
  const timeouts = (side, period) => events.filter(e => e.type === 'timeout' && e.side === side && e.period === period).map(minute)
  return {
    exact,
    fouls: { home: count('foul', 'home'), away: count('foul', 'away') },
    goals: { home: count('goal', 'home'), away: count('goal', 'away') },
    timeouts: {
      home: { first: timeouts('home', '1'), second: timeouts('home', '2') },
      away: { first: timeouts('away', '1'), second: timeouts('away', '2') },
    },
    halftime: {
      home: count('goal', 'home', e => e.period === '1'),
      away: count('goal', 'away', e => e.period === '1'),
    },
    // Native judge boards don't broadcast timeouts — say so rather than print "none".
    hasTimeouts: exact || events.some(e => e.type === 'timeout'),
    hasGoals: events.some(e => e.type === 'goal'),
    fromPaper: null,
  }
}

/** Effective captain ids for a game: the game's own record, else each team's captain. */
export function gameCaptainIds(row, home, away) {
  return {
    home: row?.home_captain_id || home?.captain_player_id || null,
    away: row?.away_captain_id || away?.captain_player_id || null,
  }
}
