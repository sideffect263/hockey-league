import { describe, it, expect } from 'vitest'
import { isLight, surfaceColors, onColor, bannerHexes, teamBlend } from './flTeam'

describe('flTeam (port of iOS FLTeam / TeamColors)', () => {
  it('white/grey is a light team; white + a real colour is not', () => {
    expect(isLight('#FFFFFF')).toBe(true)
    expect(surfaceColors('#ffffff', '#a3a3a3')).toEqual(['#ffffff', '#a3a3a3'])
    expect(surfaceColors('#FFFFFF', '#0C26E9')).toEqual(['#0C26E9', '#FFFFFF'])
    expect(onColor({ primary_color: '#ffffff', secondary_color: '#a3a3a3' })).toBe('#11161D')
    expect(onColor({ primary_color: '#FFFFFF', secondary_color: '#0C26E9' })).toBe('#FFFFFF')
  })
  it('conditions neon colours until white text reads', () => {
    const b = bannerHexes('#15f919', null)
    expect(b.start).not.toBe('#15f919')
  })
  it('blend runs away (left) → home (right), light team edge dimmed', () => {
    const g = teamBlend({ primary_color: '#D21212' }, { primary_color: '#ffffff', secondary_color: '#a3a3a3' })
    expect(g.startsWith('linear-gradient(90deg, #8C8C8C 0%')).toBe(true)
  })
})
