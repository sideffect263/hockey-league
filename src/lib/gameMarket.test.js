import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { sidesOf, isHidden, leaderChip, trendPoints, multiplier, resolvedHeadline, closesLabel, sparkSeries } from './gameMarket'

const open = {
  status: 'open', trades: 4, traders: 3,
  outcomes: [
    { okey: 'home', price: 0.8743, was: 0.8356, team_id: 'h' },
    { okey: 'draw', price: 0.0111, was: 0.0822 },
    { okey: 'away', price: 0.1146, was: 0.0822, team_id: 'a' },
  ],
  history: [
    { home: 0.3333, draw: 0.3333, away: 0.3333 },
    { home: 0.8356, draw: 0.0822, away: 0.0822 },
  ],
}

describe('gameMarket', () => {
  it('splits sides with numeric prices', () => {
    const s = sidesOf({ outcomes: [{ okey: 'home', price: '0.5', was: null }] })
    expect(s.home.price).toBe(0.5)
    expect(s.home.was).toBeNull()
    expect(s.draw).toBeNull()
  })

  it('hides void, untraded resolved, and empty', () => {
    expect(isHidden(null)).toBe(true)
    expect(isHidden({ ...open, status: 'void' })).toBe(true)
    expect(isHidden({ ...open, status: 'resolved', trades: 0 })).toBe(true)
    expect(isHidden({ ...open, outcomes: [] })).toBe(true)
    expect(isHidden(open)).toBe(false)
    expect(isHidden({ ...open, trades: 0 })).toBe(false) // open + untraded still shows (be the first)
  })

  it('favourite at a 10-point lead, otherwise close', () => {
    expect(leaderChip(open)).toEqual({ kind: 'favourite', okey: 'home' })
    expect(leaderChip({ outcomes: [{ okey: 'home', price: 0.3333 }, { okey: 'draw', price: 0.3333 }, { okey: 'away', price: 0.3334 }] })).toEqual({ kind: 'close' })
  })

  it('trend only from 3 points', () => {
    expect(trendPoints({ price: 0.8743, was: 0.8356 })).toBe(4)
    expect(trendPoints({ price: 0.0111, was: 0.0822 })).toBe(-7)
    expect(trendPoints({ price: 0.50, was: 0.48 })).toBeNull()
    expect(trendPoints({ price: 0.5, was: null })).toBeNull()
  })

  it('multiplier', () => {
    expect(multiplier(0.8743)).toBe('1.14')
    expect(multiplier(0.005)).toBeNull()
  })

  it('resolved headline tones', () => {
    expect(resolvedHeadline('רמת ישי', 0.3016, false)).toEqual({ tone: 'upset', text: 'הפתעה! התחזיות נתנו לרמת ישי רק 30%' })
    expect(resolvedHeadline('גבעת עדה', 0.87, false).tone).toBe('called')
    expect(resolvedHeadline('גבעת עדה נוער', 0.3968, false)).toEqual({ tone: 'plain', text: 'גבעת עדה נוער ניצחו עם 40% לפני המשחק' })
    expect(resolvedHeadline('', 0.2, true).text).toBe('הפתעה! התחזיות נתנו לתיקו רק 20%')
  })

  it('closes label', () => {
    const now = new Date('2026-10-12T09:00:00Z')
    expect(closesLabel('2026-10-12T15:30:00Z', now)).toBe('היום ב-18:30')
    expect(closesLabel('2026-10-13T15:30:00Z', now)).toBe('מחר ב-18:30')
    expect(closesLabel('2026-10-24T13:30:00Z', now)).toBe('בעוד 12 ימים')
  })

  it('spark series needs two points', () => {
    expect(sparkSeries(open)).toHaveLength(2)
    expect(sparkSeries({ history: [{ home: 0.33, away: 0.33 }] })).toEqual([])
  })
})
