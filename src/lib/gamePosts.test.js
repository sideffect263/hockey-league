import { describe, it, expect } from 'vitest'
import { gameDayLabel, gameLabel, pickerGames, filterGameOptions, isVideoPost, orderGamePosts } from './gamePosts'

const teams = { h: { name: 'רמת ישי' }, a: { name: 'גבעת עדה נוער' } }
const NOW = new Date('2026-10-11T09:00:00Z').getTime()
const day = (n) => new Date(NOW + n * 864e5).toISOString()

describe('gameLabel / gameDayLabel', () => {
  it('formats home נגד away · DD.MM', () => {
    expect(gameLabel({ home_team_id: 'h', away_team_id: 'a', game_date: '2026-10-10' }, teams))
      .toBe('רמת ישי נגד גבעת עדה נוער · 10.10')
  })
  it('uses Israel time, not UTC (22:30Z on the 9th is the 10th in Jerusalem)', () => {
    expect(gameDayLabel('2026-10-09T22:30:00Z')).toBe('10.10')
  })
  it('pads single digits', () => {
    expect(gameDayLabel('2026-03-05')).toBe('05.03')
  })
  it('survives unknown teams and missing dates', () => {
    expect(gameLabel({ home_team_id: 'x', away_team_id: 'y' }, teams)).toBe('? נגד ?')
    expect(gameDayLabel(null)).toBe('')
    expect(gameDayLabel('nope')).toBe('')
    expect(gameLabel(null)).toBe('')
  })
})

describe('pickerGames', () => {
  const games = [
    { id: 'old', game_date: day(-61) },
    { id: 'past', game_date: day(-59) },
    { id: 'yesterday', game_date: day(-1) },
    { id: 'test', game_date: day(-1), is_test: true },
    { id: 'soon', game_date: day(13) },
    { id: 'far', game_date: day(15) },
  ]
  it('keeps the last 60 days + next 14, drops test games, newest first', () => {
    expect(pickerGames(games, { now: NOW }).map(g => g.id)).toEqual(['soon', 'yesterday', 'past'])
  })
  it('always includes the currently linked game', () => {
    expect(pickerGames(games, { now: NOW, currentId: 'old' }).map(g => g.id)).toEqual(['soon', 'yesterday', 'past', 'old'])
  })
  it('does not mutate the input', () => {
    const copy = [...games]
    pickerGames(games, { now: NOW })
    expect(games).toEqual(copy)
  })
})

describe('filterGameOptions', () => {
  const opts = [{ id: 1, label: 'רמת ישי נגד בלג · 10.10' }, { id: 2, label: 'קריית אתא נגד הדר · 03.10' }]
  it('matches team names and dates', () => {
    expect(filterGameOptions(opts, 'בלג').map(o => o.id)).toEqual([1])
    expect(filterGameOptions(opts, '03.10').map(o => o.id)).toEqual([2])
    expect(filterGameOptions(opts, '  ')).toBe(opts)
  })
})

describe('orderGamePosts', () => {
  it('detects video posts', () => {
    expect(isVideoPost({ video_uid: 'x' })).toBe(true)
    expect(isVideoPost({ link_url: 'https://www.youtube.com/watch?v=abcdefghijk' })).toBe(true)
    expect(isVideoPost({ body: 'גול! https://youtu.be/abcdefghijk' })).toBe(true)
    expect(isVideoPost({ body: 'סתם טקסט', link_url: 'https://example.com/a?rev=abcdefg' })).toBe(false)
  })
  it('puts video posts first, newest first within each group', () => {
    const posts = [
      { id: 't-old', body: 'a', created_at: '2026-10-10T10:00:00Z' },
      { id: 'v-old', video_uid: 'u', created_at: '2026-10-10T09:00:00Z' },
      { id: 't-new', body: 'b', created_at: '2026-10-10T12:00:00Z' },
      { id: 'yt-new', body: 'https://youtu.be/abcdefghijk', created_at: '2026-10-10T11:00:00Z' },
    ]
    expect(orderGamePosts(posts).map(p => p.id)).toEqual(['yt-new', 'v-old', 't-new', 't-old'])
    expect(posts[0].id).toBe('t-old')
  })
})
