import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/gameStories', () => ({ uploadGameVideo: vi.fn() }))
const { parseTimes, fmtTime, outputLinks } = await import('./videoIngest')

describe('video ingest helpers', () => {
  it('parses goal times', () => {
    expect(parseTimes('4:12, 17:40 1:02:05')).toEqual([252, 1060, 3725])
    expect(parseTimes('90')).toEqual([90])
    expect(parseTimes('4:1x')).toBeNull()
    expect(parseTimes('  ')).toBeNull()
  })
  it('formats times', () => {
    expect(fmtTime(252)).toBe('4:12')
    expect(fmtTime(3725)).toBe('1:02:05')
  })
  it('links step outputs', () => {
    const l = outputLinks('goals', { clips: [{ id: 'c1', title: 'שער' }], drafts: ['d1'] }, 'g1')
    expect(l.map(x => x.to)).toEqual(['/devs?tab=lab&clip=c1', '/creators?tab=drafts#d1'])
    expect(outputLinks('stats', { run_id: 'r1' }, 'g1')[0].to).toBe('/devs?tab=lab&match=r1')
    expect(outputLinks('full_video', null, 'g1')).toEqual([])
  })
})
