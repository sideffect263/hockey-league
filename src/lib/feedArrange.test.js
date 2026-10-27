import { describe, it, expect } from 'vitest'
import { buildFeed, arrangeFeed, LEAGUE_ACCOUNT_ID as L } from './feed'

const NOW = Date.parse('2026-10-25T12:00:00Z')             // Sunday
const SAT = '2026-10-24T15:00:00Z'
const teams = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }]
const game = (id, date, home = 'a', away = 'b', extra = {}) => ({ id, game_date: date, status: 'completed', home_team_id: home, away_team_id: away, home_score: 3, away_score: 2, ...extra })
const post = (id, created_at, extra = {}) => ({ id, created_at, body: id, author_id: L, ...extra })
const clip = (id, created_at, game_id) => post(id, created_at, { game_id, video_uid: 'v' + id, video_cf_code: 'cf' })
const ids = feed => feed.map(p => p.id)

const games = [game('g1', SAT), game('g2', '2026-10-24T17:00:00Z', 'c', 'd'), game('g0', '2026-10-10T15:00:00Z')]
const build = (humanPosts, opts = {}) => arrangeFeed(
  buildFeed({ games, teams, humanPosts, now: NOW }),
  { games, now: NOW, ...opts })

describe('arrangeFeed', () => {
  it('folds a game\'s clips, full game and story into ONE post, clips in order', () => {
    const feed = build([
      clip('c2', '2026-10-25T08:00:00Z', 'g1'),
      clip('c1', '2026-10-25T07:00:00Z', 'g1'),
      post('full', '2026-10-25T09:00:00Z', { game_id: 'g1', body: '📺 המשחק המלא · A 3–2 B' }),
      post('story', '2026-10-25T10:00:00Z', { game_id: 'g1', body: 'what a game' }),
    ])
    const g1 = feed.find(p => p.id === 'game-g1')
    expect(g1.type).toBe('game')
    expect(g1.data.slides.map(s => s.data.post.id)).toEqual(['c1', 'c2'])
    expect(g1.data.fullGame.data.post.id).toBe('full')
    expect(g1.data.story.data.post.id).toBe('story')
    expect(ids(feed).filter(i => i.startsWith('post-'))).toEqual([])
  })

  it('folds milestones into the game', () => {
    const stats = [{ game_id: 'g1', player_id: 'p1', goals: 3 }]
    const players = [{ id: 'p1', first_name: 'X', last_name: 'Y', team_id: 'a' }]
    const feed = arrangeFeed(buildFeed({ games, teams, players, gameStats: stats, now: NOW }), { games, now: NOW })
    expect(feed.some(p => p.type === 'milestone')).toBe(false)
    expect(feed.find(p => p.id === 'game-g1').data.milestones).toHaveLength(1)
  })

  it('keeps someone else\'s post about a game as its own post, right under the game', () => {
    const feed = build([post('fan', '2026-10-25T11:00:00Z', { game_id: 'g2', author_id: 'someone' })])
    const i = ids(feed).indexOf('game-g2')
    expect(ids(feed)[i + 1]).toBe('post-fan')
  })

  it('puts your team\'s game first, then the rest of the game day, then other new posts', () => {
    const feed = build([post('bday', '2026-10-25T06:00:00Z', { source_name: 'יום הולדת', external_guid: 'birthday:00000000-0000-0000-0000-000000000000:2026' })],
      { followedTeams: new Set(['c']) })
    expect(ids(feed).slice(0, 3)).toEqual(['game-g2', 'game-g1', 'post-bday'])
  })

  it('drops the Friday preview once a game after it has started', () => {
    const preview = post('prev', '2026-10-23T07:00:00Z', { source_name: 'תצוגה מקדימה · מחזור השבת', external_guid: 'weekly-preview:2026-10-24' })
    expect(ids(build([preview]))).not.toContain('post-prev')
    const friday = Date.parse('2026-10-23T12:00:00Z')
    const before = arrangeFeed(buildFeed({ games: [game('g0', '2026-10-10T15:00:00Z')], teams, humanPosts: [preview], now: friday }),
      { games: [...games.slice(0, 2).map(g => ({ ...g, status: 'scheduled' })), game('g0', '2026-10-10T15:00:00Z')], now: friday })
    expect(ids(before)).toContain('post-prev')
  })

  it('turns all outside news into one world item below the caught-up line', () => {
    const feed = build([
      post('w1', '2026-10-25T11:00:00Z', { source_name: "Som D'hoquei", author_id: 'bot2' }),
      post('w2', '2026-10-25T10:00:00Z', { source_name: "Som D'hoquei", author_id: 'bot2' }),
    ])
    expect(feed.filter(p => p.type === 'external')).toHaveLength(0)
    const w = feed.find(p => p.type === 'world')
    expect(w.data.items.map(i => i.id)).toEqual(['post-w1', 'post-w2'])
    expect(ids(feed).indexOf('caught-up')).toBe(ids(feed).indexOf('world') - 1)
  })

  it('sinks what you already saw below the line, unless a clip was added since', () => {
    const seen = { 'game-g2': '2026-10-24T20:00:00Z', 'game-g1': '2026-10-24T20:00:00Z' }
    const feed = build([clip('late', '2026-10-25T08:00:00Z', 'g1')], { personalization: { seen } })
    const line = ids(feed).indexOf('caught-up')
    expect(ids(feed).indexOf('game-g1')).toBeLessThan(line)     // new clip since → still new
    expect(ids(feed).indexOf('game-g2')).toBeGreaterThan(line)  // nothing new → below
  })

  it('latest mode is newest change first, no line', () => {
    const feed = build([post('p', '2026-10-25T11:30:00Z')], { mode: 'latest' })
    expect(ids(feed)[0]).toBe('post-p')
    expect(ids(feed)).not.toContain('caught-up')
  })
})
