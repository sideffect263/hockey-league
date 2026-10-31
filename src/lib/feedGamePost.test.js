import { describe, it, expect } from 'vitest'
import { gameSlides, gameCover, gameCaption, predictionLine, photoFromGameDay, dayMonth } from './feedGamePost'

const game = { id: 'g1', game_date: '2026-10-24T17:00:00Z', home_score: 6, away_score: 4 }
const clip = (id) => ({ id, data: { post: { id, video_uid: 'u' + id, video_cf_code: 'cf', body: 'גול' } } })

describe('game post', () => {
  it('day.month in Israel', () => { expect(dayMonth('2026-10-24T22:30:00Z')).toBe('25.10') })
  it('only a photo from the game day joins the carousel', () => {
    expect(photoFromGameDay({ image_url: 'x', album_date: '2026-10-24' }, game.game_date)).toBe(true)
    expect(photoFromGameDay({ image_url: 'x', album_date: '2026-10-10' }, game.game_date)).toBe(false)
  })
  it('slides: band, photo, clips, milestones', () => {
    const post = { data: { game, photo: { image_url: 'p', album_date: '2026-10-24' }, slides: [clip('a'), clip('b')], milestones: [{ kind: 'hat_trick', name: 'זיו', playerId: 'p1', goals: 3 }] } }
    expect(gameSlides(post).map((s) => s.kind)).toEqual(['band', 'photo', 'clip', 'clip', 'milestone'])
    expect(gameSlides(post)[3].label).toBe('קליפ 2')
  })
  it('cover prefers a clip frame, then a same-day photo, else none', () => {
    expect(gameCover({ data: { game, slides: [clip('a')], photo: { image_url: 'p', album_date: '2026-10-24' } } })).toMatch(/cloudflarestream.*ua/)
    expect(gameCover({ data: { game, slides: [], photo: { image_url: 'p', album_date: '2026-10-24' } } })).toBe('p')
    expect(gameCover({ data: { game, slides: [], photo: { image_url: 'p', album_date: '2026-10-01' } } })).toBe(null)
  })
  it('caption: the story, else a plain line', () => {
    expect(gameCaption({ data: { game, story: { data: { post: { body: 'סיפור' } } } } }, 'א', 'ב')).toBe('סיפור')
    expect(gameCaption({ data: { game, slides: [] } }, 'אריות', 'רמת ישי')).toBe('ניצחון לאריות: אריות 6\u200F, רמת ישי 4\u200F.')
  })
  it('prediction line: crowd pick and his result', () => {
    const odds = { status: 'resolved', trades: 5, resolved_okey: 'home',
      outcomes: [{ okey: 'home', price: 0.6 }, { okey: 'away', price: 0.4 }],
      my: [{ okey: 'home', shares: 20, cost: 12 }] }
    expect(predictionLine(odds, 'אריות', 'רמת ישי')).toEqual({ crowd: 'התחזיות נסגרו · הקהל חזה אריות 60%', mine: 8 })
    expect(predictionLine({ status: 'void', outcomes: [{ okey: 'home' }] }, 'a', 'b')).toBe(null)
    expect(predictionLine(null)).toBe(null)
  })
})
