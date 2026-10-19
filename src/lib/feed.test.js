import { describe, it, expect } from 'vitest'
import { buildFeed, lastMatchday, parseRanking, RANKING_DEFAULTS } from './feed'

const H = 60 * 60 * 1000
const NOW = Date.parse('2026-10-21T12:00:00Z')            // Wednesday
const SAT = '2026-10-17T15:00:00Z'                         // last game day
const teams = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
const game = (id, date) => ({ id, game_date: date, status: 'completed', home_team_id: 'a', away_team_id: 'b', home_score: 3, away_score: 2 })
const post = (id, created_at, extra = {}) => ({ id, created_at, body: id, ...extra })
const ids = feed => feed.map(p => p.id)

describe('lastMatchday', () => {
  it('is the latest game day, with its games', () => {
    const md = lastMatchday([game('g1', SAT), game('g2', '2026-10-17T17:00:00Z'), game('g0', '2026-10-10T15:00:00Z')], NOW)
    expect([...md.gameIds].sort()).toEqual(['g1', 'g2'])
  })
  it('lapses after 15 days (off-season)', () => {
    expect(lastMatchday([game('g1', '2026-09-01T15:00:00Z')], NOW)).toBeNull()
  })
})

describe('buildFeed ranking', () => {
  const games = [game('g1', SAT), game('g0', '2026-10-10T15:00:00Z')]

  it('puts the last game day on top, even above newer posts', () => {
    const feed = buildFeed({
      games, teams, now: NOW,
      humanPosts: [
        post('story', '2026-10-18T09:00:00Z'),                                        // day after: matchday coverage
        post('tagged', '2026-10-19T08:00:00Z', { game_id: 'g1' }),                    // tied to the game
        post('later', '2026-10-21T11:00:00Z'),                                        // ours, newest, not matchday
        post('clip', '2026-10-21T11:30:00Z', { source_name: "Som D'hoquei" }),        // outside, newest
      ],
    })
    const top = ids(feed).slice(0, 3)
    expect(top).toEqual(expect.arrayContaining(['game-g1', 'post-story', 'post-tagged']))
    expect(ids(feed).indexOf('post-later')).toBeLessThan(ids(feed).indexOf('post-clip'))
  })

  it('outside news never counts as matchday, even posted that day', () => {
    const feed = buildFeed({ games, teams, now: NOW, humanPosts: [post('x', '2026-10-17T18:00:00Z', { source_name: 'OA Sport' })] })
    expect(feed.find(p => p.id === 'post-x').matchday).toBe(false)
  })

  it('a much newer outside clip can still beat an older post of ours', () => {
    const feed = buildFeed({
      games: [], teams, now: NOW,
      humanPosts: [
        post('old', new Date(NOW - 6 * 24 * H).toISOString()),
        post('clip', new Date(NOW - H).toISOString(), { source_name: "Som D'hoquei" }),
      ],
    })
    expect(ids(feed)).toEqual(['post-clip', 'post-old'])
  })

  it('ours wins against outside news of a similar age', () => {
    const feed = buildFeed({
      games: [], teams, now: NOW,
      humanPosts: [
        post('ours', new Date(NOW - 2 * 24 * H).toISOString()),
        post('clip', new Date(NOW - H).toISOString(), { source_name: "Som D'hoquei" }),
      ],
    })
    expect(ids(feed)).toEqual(['post-ours', 'post-clip'])
  })
})

describe('league-made sourced posts', () => {
  it('the Friday preview is ours, not outside news', () => {
    const feed = buildFeed({ games: [], teams, now: NOW, humanPosts: [
      post('pv', '2026-10-16T07:00:00Z', { source_name: 'תצוגה מקדימה · מחזור השבת', external_guid: 'weekly-preview:2026-10-17' }),
    ] })
    expect(feed[0].type).toBe('post')
  })
})

describe('matchday block order', () => {
  it('the game result leads the clips posted the day after', () => {
    const feed = buildFeed({ games: [game('g1', SAT)], teams, now: NOW, humanPosts: [post('clip', '2026-10-18T09:00:00Z', { game_id: 'g1' })] })
    expect(ids(feed)[0]).toBe('game-g1')
  })
})

describe('feed_ranking from the backend', () => {
  it('falls back to defaults on missing, junk or partial JSON', () => {
    const d = parseRanking(null)
    expect(d.worldPenalty).toBe(RANKING_DEFAULTS.world_penalty_hours * H)
    expect(parseRanking('{not json').leagueBoost).toBe(12 * H)
    const p = parseRanking('{"world_penalty_hours": 6, "league_boost_hours": "x"}')
    expect(p.worldPenalty).toBe(6 * H)
    expect(p.leagueBoost).toBe(12 * H)
    expect(p.birthdayPhoto).toBe(false)
  })

  it('show_world_news=false drops outside news', () => {
    const feed = buildFeed({ games: [], teams, now: NOW, ranking: '{"show_world_news": false}', humanPosts: [
      post('ours', '2026-10-20T12:00:00Z'), post('clip', '2026-10-21T11:00:00Z', { source_name: 'S' }),
    ] })
    expect(ids(feed)).toEqual(['post-ours'])
  })

  it('a zero world penalty and league boost is plain recency', () => {
    const feed = buildFeed({ games: [], teams, now: NOW, ranking: { world_penalty_hours: 0, league_boost_hours: 0 }, humanPosts: [
      post('ours', '2026-10-20T12:00:00Z'), post('clip', '2026-10-21T11:00:00Z', { source_name: 'S' }),
    ] })
    expect(ids(feed)).toEqual(['post-clip', 'post-ours'])
  })

  it('birthday_photo is carried to the birthday card', () => {
    const bday = post('b', '2026-10-21T04:00:00Z', { source_name: 'יום הולדת', external_guid: 'birthday:12345678-1234-1234-1234-123456789012:2026' })
    expect(buildFeed({ games: [], teams, now: NOW, humanPosts: [bday] })[0].data.showPhoto).toBe(false)
    expect(buildFeed({ games: [], teams, now: NOW, ranking: '{"birthday_photo": true}', humanPosts: [bday] })[0].data.showPhoto).toBe(true)
  })
})
