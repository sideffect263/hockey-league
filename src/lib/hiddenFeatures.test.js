import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { buildAnnouncement, parseAnnouncement, suggestAnnouncementId } from './hiddenFeatures'

describe('announcement JSON (docs/HIDDEN-FEATURES-SPEC.md)', () => {
  const base = { id: 'ff-2026-tickets', title: ' כרטיסים ', body: 'שורה\r\nשנייה', audience: 'all', active: true }
  it('builds the canonical shape', () => {
    const r = buildAnnouncement(base)
    expect(r.ok).toBe(true)
    expect(r.json).toEqual({ id: 'ff-2026-tickets', active: true, title: 'כרטיסים', body: 'שורה\nשנייה', audience: 'all' })
  })
  it('button needs both label and url; dates become ISO', () => {
    expect(buildAnnouncement({ ...base, button_label: 'לפרטים' }).ok).toBe(false)
    const r = buildAnnouncement({ ...base, button_label: 'לפרטים', button_url: 'https://rinkhockeyil.com/games',
      starts_at: '2026-10-12T10:00', ends_at: '2026-10-13T10:00' })
    expect(r.ok).toBe(true)
    expect(r.json.button_url).toBe('https://rinkhockeyil.com/games')
    expect(r.json.starts_at).toMatch(/^2026-10-1\dT/)
    expect(buildAnnouncement({ ...base, starts_at: '2026-10-13T10:00', ends_at: '2026-10-12T10:00' }).ok).toBe(false)
  })
  it('rejects missing id / title / body', () => {
    expect(buildAnnouncement({ ...base, id: '' }).ok).toBe(false)
    expect(buildAnnouncement({ ...base, title: ' ' }).ok).toBe(false)
    expect(buildAnnouncement({ ...base, body: '' }).ok).toBe(false)
  })
  it('parse: empty / invalid → null', () => {
    expect(parseAnnouncement('')).toBeNull()
    expect(parseAnnouncement('{oops')).toBeNull()
    expect(parseAnnouncement('[1]')).toBeNull()
    expect(parseAnnouncement('{"id":"a"}')).toEqual({ id: 'a' })
  })
  it('id suggestion = slug + date', () => {
    expect(suggestAnnouncementId('FF Tickets!', new Date('2026-10-11T12:00:00Z'))).toBe('ff-tickets-2026-10-11')
    expect(suggestAnnouncementId('כרטיסים', new Date('2026-10-11T12:00:00Z'))).toBe('announcement-2026-10-11')
  })
})
