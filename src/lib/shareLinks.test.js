import { describe, it, expect } from 'vitest'
import { buildShare, firstLine, resultText, sharePath } from './shareLinks'

const O = 'https://rinkhockeyil.com'
const PID = '11111111-2222-3333-4444-555555555555'

describe('buildShare', () => {
  it('game result → game slug, home score beside home, en dash', () => {
    const post = {
      type: 'game_result',
      data: {
        game: { id: 'g1', slug: 'רמת-ישי-נגד-בלג-2026-10-10', home_score: 5, away_score: 3 },
        home: { name: 'רמת ישי' }, away: { name: 'בלג' },
      },
    }
    const s = buildShare(post)
    expect(s.url).toBe(`${O}/games/${encodeURIComponent('רמת-ישי-נגד-בלג-2026-10-10')}`)
    expect(s.text).toBe('רמת ישי 5–3 בלג · ליגת הוקי הגלגיליות')
    expect(s.type).toBe('game_result')
  })

  it('game result without a slug falls back to the id', () => {
    const s = buildShare({ type: 'game_result', data: { game: { id: 'abc', home_score: 0, away_score: 0 }, home: { name: 'א' }, away: { name: 'ב' } } })
    expect(s.url).toBe(`${O}/games/abc`)
  })

  it('milestone → player slug from playersMap, headline', () => {
    const s = buildShare(
      { type: 'milestone', data: { kind: 'hat_trick', name: 'יואב תורגמן', playerId: PID, goals: 3, game: { id: 'g' } } },
      { playersMap: { [PID]: { id: PID, slug: 'יואב-תורגמן' } } },
    )
    expect(s.url).toBe(`${O}/players/${encodeURIComponent('יואב-תורגמן')}`)
    expect(s.text).toBe('🎩 יואב תורגמן כבש 3 שערים')
  })

  it('milestone of a guest (no player page) → the game', () => {
    const s = buildShare({ type: 'milestone', data: { kind: 'big_game', name: 'אורח', playerId: null, goals: 5, game: { id: 'g9' } } })
    expect(s.url).toBe(`${O}/games/g9`)
    expect(s.text).toBe('🔥 אורח כבש 5 שערים')
  })

  it('milestone with a player id but no map → the uuid path', () => {
    const s = buildShare({ type: 'milestone', data: { name: 'x', playerId: PID, goals: 3 } })
    expect(s.url).toBe(`${O}/players/${PID}`)
  })

  it('top scorer → player page', () => {
    const s = buildShare({ type: 'top_scorer', data: { player: { id: PID, slug: 'דני-כהן', first_name: 'דני', last_name: 'כהן' }, goals: 31 } })
    expect(s.url).toBe(`${O}/players/${encodeURIComponent('דני-כהן')}`)
    expect(s.text).toBe('דני כהן — מלך השערים של העונה (31 שערים)')
  })

  it('champion → team page', () => {
    const s = buildShare({ type: 'champion', data: { team: { id: 't', slug: 'בלג', name: 'בלג בוגרים' } } })
    expect(s.url).toBe(`${O}/teams/${encodeURIComponent('בלג')}`)
    expect(s.text).toBe('בלג בוגרים אלופת העונה 🏆')
  })

  it('human post → permalink + first line', () => {
    const s = buildShare({ type: 'post', data: { post: { id: 'p1', body: '\nשורה ראשונה\nשורה שנייה' } } })
    expect(s).toMatchObject({ url: `${O}/posts/p1`, text: 'שורה ראשונה', type: 'post' })
  })

  it('news post → permalink + headline, never the source link', () => {
    const s = buildShare({ type: 'external', data: { post: { id: 'n1', body: 'כותרת\n\nתקציר', link_url: 'https://example.com/x', source_name: 'WSE' } } })
    expect(s.url).toBe(`${O}/posts/n1`)
    expect(s.text).toBe('כותרת')
  })

  it('birthday post → the player page', () => {
    const post = { type: 'post', data: { post: { id: 'b1', body: 'יום הולדת', external_guid: `birthday:${PID}:2026` } } }
    const s = buildShare(post, { playersMap: { [PID]: { id: PID, slug: 'רון-לוי', first_name: 'רון', last_name: 'לוי' } } })
    expect(s.url).toBe(`${O}/players/${encodeURIComponent('רון-לוי')}`)
    expect(s.text).toBe('יום הולדת שמח לרון לוי! 🎂')
    expect(s.type).toBe('birthday')
  })

  it('market cards have no share', () => {
    expect(buildShare({ type: 'market', data: {} })).toBeNull()
    expect(buildShare(null)).toBeNull()
    expect(buildShare({ type: 'unknown' })).toBeNull()
  })

  it('first line ≤140 chars, YouTube links dropped', () => {
    expect(firstLine('https://youtu.be/abcdefgh\nהשער של השבוע')).toBe('השער של השבוע')
    const long = 'א'.repeat(200)
    expect(firstLine(long)).toHaveLength(140)
    expect(firstLine(long).endsWith('…')).toBe(true)
    expect(firstLine('')).toBe('')
  })

  it('helpers', () => {
    expect(resultText('א', 1, 2, 'ב')).toBe('א 1–2 ב · ליגת הוקי הגלגיליות')
    expect(sharePath('teams', null)).toBeNull()
    expect(sharePath('teams', { id: 'x' })).toBe('/teams/x')
  })
})
