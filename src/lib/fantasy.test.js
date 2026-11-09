import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))
const F = await import('./fantasy.js')

const pool = [
  { id: 'g1', gk: true, team_id: 'A', price: 6 },
  { id: 'g2', gk: true, team_id: 'B', price: 5 },
  { id: 'a1', gk: false, team_id: 'A', price: 12 },
  { id: 'a2', gk: false, team_id: 'A', price: 5 },
  { id: 'b1', gk: false, team_id: 'B', price: 10 },
  { id: 'c1', gk: false, team_id: 'C', price: 5 },
  { id: 'c2', gk: false, team_id: 'C', price: 4.5 },
  { id: 'd1', gk: false, team_id: 'D', price: 12 },
  { id: 'e1', gk: false, team_id: 'E', price: 5 },
]
const byId = new Map(pool.map(p => [p.id, p]))
const state = { budget: 50, max_per_team: 2, teams: [], my_player_id: null }

function full() {
  const l = F.emptyLineup()
  const ids = ['g1', 'a1', 'b1', 'c1', 'c2', 'g2', 'e1']
  l.forEach((s, i) => { s.player_id = ids[i] })
  l[1].captain = true
  return l
}

describe('fantasy lineup rules', () => {
  it('a valid squad has no problems and costs the sum of prices', () => {
    const l = full()
    expect(F.lineupCost(l, byId)).toBe(47.5)
    expect(F.lineupProblems(l, byId, state, 'הסטיק')).toEqual([])
  })

  it('blocks a third player from one team', () => {
    const l = full()
    // A already has g1 + a1
    expect(F.blockReason(byId.get('a2'), 6, l, byId, state)).toBe('כבר 2 מהקבוצה')
    l[6].player_id = 'a2'
    expect(F.lineupProblems(l, byId, state, 'xx').some(p => p.includes('יותר מ-2'))).toBe(true)
  })

  it('blocks a GK in a field slot and an over-budget pick', () => {
    const l = full()
    expect(F.blockReason(byId.get('g2'), 2, l, byId, state)).toBe('שוער')
    l[4].player_id = null // free c2 (4.5) → 43 spent, 7 left
    expect(F.blockReason(byId.get('d1'), 4, l, byId, state)).toBe('מעל התקציב')
  })

  it('cannot pick yourself', () => {
    const l = F.emptyLineup()
    expect(F.blockReason(byId.get('c1'), 1, l, byId, { ...state, my_player_id: 'c1' })).toBe('זה אתם')
  })

  it('needs a captain in the starting five and a name', () => {
    const l = full(); l[1].captain = false
    const p = F.lineupProblems(l, byId, state, 'x')
    expect(p).toContain('בחרו קפטן')
    expect(p.some(s => s.includes('שם'))).toBe(true)
  })

  it('counts transfers against the base squad; first squad is free', () => {
    const l = full()
    expect(F.transfersAgainst(l, [])).toBe(0)
    expect(F.transfersAgainst(l, ['g1', 'a1', 'b1', 'c1', 'c2', 'g2', 'd1'])).toBe(1) // e1 is new
    expect(F.transferPenalty(1)).toBe(0)
    expect(F.transferPenalty(3)).toBe(6)
  })

  it('round-trips the server shape in slot order', () => {
    const l = full()
    const back = F.fromServer(F.toServer(l).reverse())
    expect(back.map(s => s.slot)).toEqual(F.SLOTS)
    expect(new Set(F.lineupIds(back))).toEqual(new Set(F.lineupIds(l)))
    expect(back.find(s => s.captain).player_id).toBe('a1')
  })
})
