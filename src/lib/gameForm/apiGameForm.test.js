import { describe, it, expect } from 'vitest'
import { mergeFields } from '../../../api/game-form.js'

const defaults = {
  medic: 'חובש', observer: '', homeFouls: '3', timeouts: { home: { first: [5], second: [] } },
  coachOptions: { home: ['א'], away: [] }, guestTeams: { g1: 'home', g2: 'home' },
}
const guests = [{ id: 'g1' }, { id: 'g2' }]

describe('api/game-form mergeFields', () => {
  it('overlays known text fields only, as strings', () => {
    const f = mergeFields(defaults, { observer: 'צופה', homeFouls: 7, timeouts: 'x', coachOptions: 'x', bogus: 1 }, guests)
    expect(f.observer).toBe('צופה')
    expect(f.homeFouls).toBe('7')
    expect(f.timeouts).toEqual(defaults.timeouts)
    expect(f.coachOptions).toEqual(defaults.coachOptions)
    expect(f.bogus).toBeUndefined()
    expect(f.medic).toBe('חובש')
  })
  it('accepts a guest side only for a known guest and a real side', () => {
    const f = mergeFields(defaults, { guestTeams: { g1: 'away', g2: 'middle', g3: 'away' } }, guests)
    expect(f.guestTeams).toEqual({ g1: 'away', g2: 'home' })
  })
  it('caps field length', () => {
    expect(mergeFields(defaults, { observer: 'x'.repeat(2000) }, guests).observer).toHaveLength(500)
  })
})
