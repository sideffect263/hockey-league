import { describe, it, expect } from 'vitest'
import { postTitle } from './shareLinks'
import { postHeadline } from '../../api/og.js'
import { isoDuration } from '../../api/sitemap.js'

// The SPA's /posts title (postTitle) and the search-bot copy's (postHeadline) must agree,
// or Google sees two titles for one page.
const BODIES = [
  '🔵 1–3\nגבעת עדה נוער ממשיכה לברוח',
  'כל הגולים של השבוע · משחקי 10.10 \nאיזה גול הכי יפה? כתבו בתגובות 👇',
  '📺 המשחק המלא · רמת ישי 4–8 גבעת עדה נוער\nhttps://youtu.be/sJ8llMyUntA',
  'https://youtu.be/abc123xyz\n\nגול!',
  '⚪ גול מהמם של אורי רייזלר!',
  '',
  'א'.repeat(200),
]

describe('post title parity', () => {
  it.each(BODIES)('same title for %#', (body) => {
    expect(postTitle(body)).toBe(postHeadline(body))
  })
  it('joins a score-only first line with the next', () => {
    expect(postTitle('🔵 1–3\nגבעת עדה נוער ממשיכה לברוח')).toBe('🔵 1–3 · גבעת עדה נוער ממשיכה לברוח')
  })
})

describe('isoDuration', () => {
  it('formats schema.org durations', () => {
    expect(isoDuration(89.7)).toBe('PT1M30S')
    expect(isoDuration(24)).toBe('PT24S')
    expect(isoDuration(2821.96)).toBe('PT47M2S')
    expect(isoDuration(3600)).toBe('PT1H')
    expect(isoDuration(null)).toBe(null)
  })
})
