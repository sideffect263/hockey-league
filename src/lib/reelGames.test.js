import { describe, it, expect } from 'vitest'
import { reelDay, dayGameLabel, localDay } from './reelGames.js'

describe('reelDay', () => {
  it('reads the game day from a reel headline', () => {
    expect(reelDay('🏒 תקציר גולים · משחקי 24.10 בגבעת עדה', '2026-11-03T10:00:00Z')).toBe('2026-10-24')
    expect(reelDay('כל הגולים של השבוע · משחקי 10.10 \nאיזה גול', '2026-10-14T08:00:00Z')).toBe('2026-10-10')
  })
  it('goes back a year across New Year', () => {
    expect(reelDay('משחקי 27.12', '2027-01-02T08:00:00Z')).toBe('2026-12-27')
  })
  it('ignores posts without a day, and full dates', () => {
    expect(reelDay('גול מטורף!', '2026-10-14T08:00:00Z')).toBeNull()
    expect(reelDay('משחקי 10.10.2026', '2026-10-14T08:00:00Z')).toBeNull()
    expect(reelDay('משחקי 40.10', '2026-10-14T08:00:00Z')).toBeNull()
  })
})

describe('dayGameLabel', () => {
  it('shows the score once played', () => {
    expect(dayGameLabel({ status: 'completed', home_score: 4, away_score: 8 }, 'רמת ישי', 'גבעת עדה נוער')).toBe('רמת ישי 4 - 8 גבעת עדה נוער')
    expect(dayGameLabel({ status: 'scheduled' }, 'א', 'ב')).toBe('א נגד ב')
  })
})

describe('localDay', () => {
  it('uses Israel time, not UTC', () => {
    expect(localDay('2026-10-23T22:30:00Z')).toBe('2026-10-24')
    expect(localDay('2026-10-24T16:00:00+00:00')).toBe('2026-10-24')
  })
})
