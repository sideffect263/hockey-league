import { describe, it, expect } from 'vitest'
import {
  periodIndex, periodKey, buildTimeline, timelineRows, blueTimers, resolveStage, STAGE,
  roundsOf, dayAndDate, timeOf, daysUntil, span, minuteMark, chipText,
} from './flGamesKit'

const P = 25 * 60000 // 25:00 halves

describe('live timeline periods (port of iOS FLTimelinePeriodTests)', () => {
  it('reads halves from bare digits and labels', () => {
    expect(periodIndex('1')).toBe(1)
    expect(periodIndex('2')).toBe(2)
    expect(periodIndex('מחצית 1')).toBe(1)
    expect(periodIndex('מחצית 2')).toBe(2)
  })
  it('puts overtime after the halves', () => {
    expect(periodIndex('הארכה 1')).toBe(4)
    expect(periodIndex('הארכה 2')).toBe(5)
    expect(periodIndex('הארכה 1')).toBeGreaterThan(periodIndex('מחצית 2'))
  })
  it('period keys match the events', () => {
    expect(periodKey('מחצית 2')).toBe('2')
    expect(periodKey('2')).toBe('2')
    expect(periodKey('הארכה 1')).toBe('הארכה 1')
    expect(periodKey(null)).toBe(null)
  })
})

describe('buildTimeline', () => {
  it('a "מחצית 2" event is a second-half minute, not overtime', () => {
    const [e] = buildTimeline([{ id: 'a', type: 'goal', side: 'home', timeMS: P - 5 * 60000, period: 'מחצית 2' }], P)
    expect(e.minute).toBe(31)
    expect(timelineRows([e]).some(r => r.divider)).toBe(false)
  })
  it('orders by period then clock, with running scores', () => {
    const t = buildTimeline([
      { id: 'late', type: 'goal', side: 'away', timeMS: P - 20 * 60000, period: '1' },
      { id: 'early', type: 'goal', side: 'home', timeMS: P - 3 * 60000, period: '1' },
      { id: 'h2', type: 'goal', side: 'home', timeMS: P - 60000, period: 'מחצית 2' },
      { id: 'brk', type: 'break', side: null, period: '1' },
    ], P)
    expect(t.map(e => e.id)).toEqual(['early', 'late', 'h2'])
    expect(t.map(e => e.scoreAfter)).toEqual([[1, 0], [1, 1], [2, 1]])
    expect(t.map(e => e.minute)).toEqual([4, 21, 27])
  })
  it('rows are newest first with a half divider carrying the half-time score', () => {
    const rows = timelineRows(buildTimeline([
      { id: 'a', type: 'goal', side: 'home', timeMS: P - 60000, period: '1' },
      { id: 'b', type: 'blue', side: 'away', timeMS: P - 60000, period: '2' },
    ], P))
    expect(rows.map(r => r.id)).toEqual(['b', 'div-1', 'a'])
    expect(rows[1]).toMatchObject({ divider: 'מחצית 1', h: 1, a: 0 })
  })
})

describe('blueTimers', () => {
  const live = (period, events, phase = 'running') => ({ period, phase, state: { events } })
  it('counts 2:00 down from the clock time the card was shown at', () => {
    const l = live('מחצית 2', [{ id: 'c', type: 'blue', side: 'away', player: '#7', timeMS: 600000, period: '2' }])
    expect(blueTimers(l, false, 560000)).toEqual([{ id: 'c', who: '#7', remaining: 80000 }])
    expect(blueTimers(l, true, 560000)).toEqual([])
    expect(blueTimers(l, false, 470000)).toEqual([]) // served
  })
  it('none in a break or another period', () => {
    const ev = [{ id: 'c', type: 'blue', side: 'home', timeMS: 600000, period: '1' }]
    expect(blueTimers(live('מחצית 2', ev), true, 590000)).toEqual([])
    expect(blueTimers(live('הפסקה', ev, 'breakTime'), true, 590000)).toEqual([])
  })
})

describe('stages', () => {
  const g = (o) => ({ id: 'g', status: 'scheduled', game_date: '2026-11-21T18:00:00Z', ...o })
  const now = new Date('2026-11-21T10:00:00Z')
  it('resolves every stage', () => {
    expect(resolveStage(g({}), null, new Date('2026-11-10T10:00:00Z'))).toBe(STAGE.before)
    expect(resolveStage(g({}), null, now)).toBe(STAGE.gameDay)
    expect(resolveStage(g({ status: 'postponed' }), null, now)).toBe(STAGE.postponed)
    expect(resolveStage(g({}), { phase: 'running', period: 'מחצית 1' }, now)).toBe(STAGE.live)
    expect(resolveStage(g({}), { phase: 'breakTime', period: 'פסק זמן' }, now)).toBe(STAGE.live)
    expect(resolveStage(g({}), { phase: 'breakTime', period: 'הפסקה' }, now)).toBe(STAGE.halfTime)
    expect(resolveStage(g({ status: 'completed' }), null, new Date('2026-11-21T19:30:00Z'))).toBe(STAGE.justEnded)
    expect(resolveStage(g({ status: 'completed' }), null, new Date('2026-11-23T10:00:00Z'))).toBe(STAGE.after)
    expect(resolveStage(g({ status: 'in_progress' }), { phase: 'over' }, new Date('2026-11-21T19:30:00Z'))).toBe(STAGE.justEnded)
  })
  it('chip text', () => {
    expect(chipText(g({ status: 'completed' }), STAGE.after, { round: 4 })).toBe('הסתיים · מחזור 4')
    expect(chipText(g({}), STAGE.before, { now: new Date('2026-11-20T10:00:00Z') })).toBe('מחר')
  })
})

describe('format + rounds', () => {
  it('formats Israel time', () => {
    expect(dayAndDate('2026-11-21T18:00:00Z')).toBe('שבת 21.11')
    expect(timeOf('2026-11-21T18:00:00Z')).toBe('20:00')
    expect(daysUntil('2026-11-21T18:00:00Z', new Date('2026-11-18T10:00:00Z'))).toBe('בעוד 3 ימים')
    expect(span(45 * 60)).toBe('45 דק׳')
    expect(span(135 * 60)).toBe('2 שע׳ ו־15 דק׳')
    expect(minuteMark(12)).toBe('12׳')
  })
  it('a round is a league matchday; friendlies get none', () => {
    const r = roundsOf([
      { id: 'a', game_date: '2026-10-10T13:30:00Z', game_type: 'ליגה' },
      { id: 'b', game_date: '2026-10-10T17:00:00Z', game_type: 'ליגה' },
      { id: 'c', game_date: '2026-10-24T13:30:00Z', game_type: 'ליגה' },
      { id: 'f', game_date: '2026-10-17T13:30:00Z', game_type: 'ידידותי' },
    ])
    expect(r).toEqual({ a: 1, b: 1, c: 2 })
  })
})
