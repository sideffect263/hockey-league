import { describe, it, expect } from 'vitest'
import { buildCaptions, momentLabel, gameDays, sizedPhoto, suggestText } from './studio'

describe('studio captions', () => {
  it('builds one caption per chosen platform', () => {
    const c = buildCaptions({ text: '⚪ גול!', teams: ['קריית מוצקין', 'רמת ישי'], link: '/games/x', outputs: ['site', 'instagram', 'facebook'] })
    expect(Object.keys(c)).toEqual(['site', 'instagram', 'facebook'])
    expect(c.site).toBe('⚪ גול!')
    expect(c.instagram).toContain('#קרייתמוצקין')
    expect(c.instagram).not.toContain('https://')
    expect(c.facebook).toContain('https://rinkhockeyil.com/games/x')
  })
})

describe('studio labels', () => {
  it('drops the game prefix when the game is shown anyway', () => {
    expect(momentLabel('קריית מוצקין 10–3 קריית ביאליק · גול של אורי', true)).toBe('גול של אורי')
    expect(momentLabel('קריית מוצקין 10–3 קריית ביאליק · גול של אורי', false)).toContain('קריית מוצקין')
  })
  it('lists several moments in the suggested text', () => {
    expect(suggestText({ type: 'goal', items: [{ label: 'א' }, { label: 'ב' }] })).toContain('▪️ ב')
  })
})

describe('game days', () => {
  const g = (id, date, status, hs = null) => ({ id, game_date: date, status, home_score: hs, away_score: hs, home_team_id: 'h', away_team_id: 'a' })
  it('groups finished games by Israel date, newest first', () => {
    const days = gameDays([g(1, '2026-10-10T15:00:00Z', 'completed', 1), g(2, '2026-10-10T17:00:00Z', 'completed', 2), g(3, '2026-10-03T15:00:00Z', 'completed', 0), g(4, '2026-10-17T15:00:00Z', 'scheduled')], 'past')
    expect(days.map(d => d.day)).toEqual(['2026-10-10', '2026-10-03'])
    expect(days[0].games).toHaveLength(2)
  })
})

describe('photo sizes', () => {
  it('uses the image transform for Supabase public objects', () => {
    expect(sizedPhoto('https://api.rinkhockeyil.com/storage/v1/object/public/game-stills/a.jpg', 400))
      .toBe('https://api.rinkhockeyil.com/storage/v1/render/image/public/game-stills/a.jpg?width=400&quality=70')
  })
})
