/**
 * Floodlight games kit (web): pure helpers for the games list, the game page stages,
 * the live timeline and the fan TV. A port of iOS FLGamesKit.swift (branch floodlight):
 * FLGameStage, FLGameFormat, FLRounds, FLTimelineEvent — same rules, so a game reads the
 * same on the site and the apps. No React, no fetching: unit-tested in flGamesKit.test.js.
 */
import { GameRules } from '@/lib/game/rules'

const TZ = 'Asia/Jerusalem'
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const asDate = (v) => (v instanceof Date ? v : new Date(v))

/** "2026-11-21" — the Israel calendar day of a timestamp. */
export function dayKey(v) {
  const d = asDate(v)
  return Number.isNaN(d.getTime()) ? '' : ymd.format(d)
}

/** Weekday index (0 = Sunday) of an Israel day key. */
const weekdayOfKey = (key) => new Date(`${key}T12:00:00Z`).getUTCDay()

/** "שבת" — the Hebrew weekday name (no "יום"). */
export const weekday = (v) => DAY_NAMES[weekdayOfKey(dayKey(v))] || ''

/** "21.11" */
export function dayMonth(v) {
  const k = dayKey(v)
  if (!k) return ''
  const [, m, d] = k.split('-')
  return `${+d}.${+m}`
}

/** "28.02.26" */
export function shortDate(v) {
  const k = dayKey(v)
  if (!k) return ''
  const [y, m, d] = k.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

/** "20:00" (Israel time). */
export function timeOf(v) {
  const d = asDate(v)
  return Number.isNaN(d.getTime()) ? '' : hm.format(d)
}

/** "שבת 21.11" */
export const dayAndDate = (v) => `${weekday(v)} ${dayMonth(v)}`

/** Whole Israel days from `now` to `v` (negative = past). */
export function daysBetween(now, v) {
  const a = dayKey(now), b = dayKey(v)
  if (!a || !b) return 0
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/** "היום" / "מחר" / "בעוד יומיים" / "בעוד 3 ימים" */
export function daysUntil(v, now = new Date()) {
  const n = daysBetween(now, v)
  if (n < 1) return 'היום'
  if (n === 1) return 'מחר'
  if (n === 2) return 'בעוד יומיים'
  return `בעוד ${n} ימים`
}

/** "45 דק׳" / "2 שע׳" / "2 שע׳ ו־15 דק׳" for a span in seconds. */
export function span(seconds) {
  const m = Math.max(1, Math.ceil(seconds / 60))
  if (m < 60) return `${m} דק׳`
  const h = Math.floor(m / 60), r = m % 60
  return r === 0 ? `${h} שע׳` : `${h} שע׳ ו־${r} דק׳`
}

/** A minute mark with geresh: 12 → "12׳" (never an apostrophe: it jumps in RTL). */
export const minuteMark = (n) => (n == null ? '' : `${n}׳`)

// ---------------------------------------------------------------- rounds

const isLeague = (g) => !g.tournament_id && (!g.game_type || g.game_type === 'ליגה')

/**
 * game id → league round ("מחזור N"). A round is one league matchday (there is no round
 * column): the game's Israel day's place among the season's league days. Playoff,
 * friendly and tournament games get no round.
 */
export function roundsOf(games = []) {
  const dayOf = {}
  for (const g of games) if (g?.game_date && isLeague(g)) dayOf[g.id] = dayKey(g.game_date)
  const days = [...new Set(Object.values(dayOf))].sort()
  const index = Object.fromEntries(days.map((d, i) => [d, i + 1]))
  return Object.fromEntries(Object.entries(dayOf).map(([id, d]) => [id, index[d]]))
}

// ---------------------------------------------------------------- stages

export const STAGE = {
  before: 'before', gameDay: 'gameDay', live: 'live', halfTime: 'halfTime',
  justEnded: 'justEnded', after: 'after', postponed: 'postponed',
}

/** How long after kick-off a finished game still counts as "just ended". */
export const JUST_ENDED_MS = 4 * 3600 * 1000

const liveIsOver = (live) => live?.phase === 'over'
const liveIsBreak = (live) => live?.phase === 'breakTime'
const liveIsTimeout = (live) => liveIsBreak(live) && /פסק זמן/.test(live?.period || '')

/**
 * The game page's stage (GameStage / GameStates boards). `live` is the live_game_state
 * row (or null). Port of iOS FLGameStage.resolve.
 */
export function resolveStage(game, live, now = new Date()) {
  if (!game) return STAGE.before
  if (game.status === 'postponed') return STAGE.postponed
  if (live && !liveIsOver(live)) return liveIsBreak(live) && !liveIsTimeout(live) ? STAGE.halfTime : STAGE.live
  // The board's "over" wins over a row still in_progress (the finish RPC sets completed later).
  if (game.status === 'in_progress' && !liveIsOver(live)) return STAGE.live
  if (game.status === 'completed' || liveIsOver(live) || game.status === 'waiting_result') {
    return asDate(now) - asDate(game.game_date) < JUST_ENDED_MS ? STAGE.justEnded : STAGE.after
  }
  return dayKey(game.game_date) === dayKey(now) ? STAGE.gameDay : STAGE.before
}

export const isPlayedStage = (s) => s === STAGE.justEnded || s === STAGE.after
export const isLiveStage = (s) => s === STAGE.live || s === STAGE.halfTime

/** The hero chip text: what stage the game is in ("הסתיים · מחזור 4"). */
export function chipText(game, stage, { live = null, now = new Date(), round = null } = {}) {
  switch (stage) {
    case STAGE.before: return daysUntil(game.game_date, now)
    case STAGE.gameDay: {
      const d = (asDate(game.game_date) - asDate(now)) / 1000
      return d > 0 ? `היום · מתחיל בעוד ${span(d)}` : `היום · ${timeOf(game.game_date)}`
    }
    case STAGE.postponed: return 'נדחה'
    case STAGE.live: return 'חי'
    case STAGE.halfTime: return 'הפסקת מחצית'
    case STAGE.justEnded:
      if (game.status === 'waiting_result') return 'ממתין לתוצאה'
      return liveIsOver(live) ? 'הסתיים עכשיו' : 'הסתיים · היום'
    case STAGE.after:
      if (game.status === 'waiting_result') return 'ממתין לתוצאה'
      return round ? `הסתיים · מחזור ${round}` : 'הסתיים'
    default: return ''
  }
}

// ---------------------------------------------------------------- timeline

/**
 * 1–3 = halves (or thirds), 4+ = overtime. Boards send bare digits ("2") AND labels
 * ("מחצית 2", "הארכה 1"); only a bare digit used to match on iOS, so every "מחצית N"
 * event read as overtime (+50 min and a הארכה divider, QA 2026-10-28).
 */
export function periodIndex(period) {
  const p = String(period ?? '')
  const m = p.match(/\d/)
  const digit = m ? +m[0] : null
  if (p.includes('הארכה')) return 3 + (digit ?? 1)
  return digit ?? 9
}

/** "מחצית 2" → "2", "הארכה 1" → "הארכה 1" (the events' period keys); null when unknown. */
export function periodKey(label) {
  if (label == null) return null
  const m = String(label).match(/\d/)
  if (String(label).includes('הארכה')) return m ? `הארכה ${m[0]}` : null
  return m ? m[0] : null
}

const KINDS = new Set(['goal', 'blue', 'yellow', 'red', 'timeout', 'foul'])

/**
 * The two-sided timeline, oldest first, from the judge board's events
 * ({ id, type, side, player, timeMS, period, ownGoal }). `timeMS` is the clock REMAINING
 * in that period. Adds `home`, `minute` (1-based game minute) and `scoreAfter` [h, a]
 * on goals. Ordered by period, then clock (more time left = earlier), then arrival.
 */
export function buildTimeline(events = [], periodMS = GameRules.defaultPeriodMS) {
  const raw = (events || []).filter(e => e && KINDS.has(e.type))
  const out = raw.map((e, i) => {
    const pi = periodIndex(e.period)
    let minute = null
    if (Number.isFinite(e.timeMS) && periodMS > 0) {
      const elapsed = Math.max(0, periodMS - e.timeMS)
      const base = Math.min(pi, 3) - 1
      minute = base * Math.floor(periodMS / 60000) + Math.floor(elapsed / 60000) + 1
    }
    return {
      id: e.id || `e${i}`, kind: e.type, home: e.side === 'home', player: e.player || null,
      ownGoal: !!e.ownGoal, period: e.period ?? '', periodIndex: pi, minute, scoreAfter: null,
      _left: Number.isFinite(e.timeMS) ? e.timeMS : null, _order: i,
    }
  })
  out.sort((a, b) => {
    if (a.periodIndex !== b.periodIndex) return a.periodIndex - b.periodIndex
    if (a._left != null && b._left != null && a._left !== b._left) return b._left - a._left
    return a._order - b._order
  })
  let h = 0, a = 0
  for (const e of out) {
    if (e.kind === 'goal') { if (e.home) h++; else a++; e.scoreAfter = [h, a] }
    delete e._left; delete e._order
  }
  return out
}

/**
 * Timeline rows newest first, with a divider { divider: 'מחצית 1', h, a } where a period
 * ended (the score at that moment).
 */
export function timelineRows(timeline = []) {
  const out = []
  let h = 0, a = 0, last = null
  for (const e of timeline) {
    if (last != null && e.periodIndex !== last) {
      out.push({ id: `div-${last}`, divider: last <= 3 ? `מחצית ${last}` : 'הארכה', h, a })
    }
    if (e.kind === 'goal') { if (e.home) h++; else a++ }
    out.push(e)
    last = e.periodIndex
  }
  return out.reverse()
}

/**
 * Running blue cards of one side, newest first: 2:00 from the clock time the card was
 * shown at, in the current period (the board's timers run off the game clock).
 * → [{ id, who, remaining }] (remaining in ms). Empty during a break.
 */
export function blueTimers(live, home, remainingMS) {
  const period = periodKey(live?.period)
  if (!period || liveIsBreak(live)) return []
  const penalty = GameRules.blueCardSeconds * 1000
  const out = []
  for (const e of [...(live?.state?.events || [])].reverse()) {
    if (e.type !== 'blue' || (e.side === 'home') !== home || periodKey(e.period) !== period) continue
    if (!Number.isFinite(e.timeMS)) continue
    const left = penalty - (e.timeMS - remainingMS)
    if (left > 0 && left <= penalty) out.push({ id: e.id, who: e.player || 'כחול', remaining: left })
  }
  return out
}

/** Remaining ms on a live row's clock (absolute deadline while running). */
export function liveRemaining(live, now = Date.now()) {
  if (!live) return 0
  if (live.is_running && live.clock_ends_at) return Math.max(0, new Date(live.clock_ends_at).getTime() - now)
  return Math.max(0, live.clock_remaining_ms ?? 0)
}

export { liveIsOver, liveIsBreak, liveIsTimeout }
