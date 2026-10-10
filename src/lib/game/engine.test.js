import { describe, it, expect } from 'vitest'
import { GameEngine } from './engine'
import { Phase, TeamSide, GameFormat, BreakKind, defaultSettings, Half } from './rules'

// Fake monotonic clock (seconds) so the engine runs without real waits.
function make(settingsPatch = {}) {
  let t = 1000
  const now = () => t
  const settings = { ...defaultSettings(), ...settingsPatch }
  const e = new GameEngine({ settings, homeName: 'בית', guestName: 'חוץ', now })
  const advance = (sec) => { t += sec; if (e.needsTicking()) e.tick() }
  return { e, advance }
}
const goals = (e, side, n) => { for (let i = 0; i < n; i++) e.addGoal(side) }

describe('GameEngine.endGameNow', () => {
  it('is not offered on a pristine board', () => {
    const { e } = make()
    expect(e.canEndNow()).toBe(false)
  })

  it('is offered once the clock has started, even with no events', () => {
    const { e } = make()
    e.toggleClock()
    expect(e.canEndNow()).toBe(true)
    e.toggleClock()
    expect(e.phase).toBe(Phase.paused)
    expect(e.canEndNow()).toBe(true)
  })

  it('ends from ready with goals entered after the fact (clock never started)', () => {
    const { e } = make()
    goals(e, TeamSide.home, 10)
    goals(e, TeamSide.guest, 3)
    expect(e.phase).toBe(Phase.ready)
    expect(e.canEndNow()).toBe(true)
    e.endGameNow()
    expect(e.phase).toBe(Phase.over)
    expect(e.result).toBe('homeWin')
    expect(e.homeFinalScore).toBe(10)
    expect(e.guestFinalScore).toBe(3)
    expect(e.clock.isRunning).toBe(false)
    expect(e.canEndNow()).toBe(false)
  })

  it('ends from a running clock and stops it', () => {
    const { e, advance } = make()
    e.toggleClock()
    advance(60)
    goals(e, TeamSide.guest, 2)
    goals(e, TeamSide.home, 1)
    e.endGameNow()
    expect(e.phase).toBe(Phase.over)
    expect(e.clock.isRunning).toBe(false)
    expect(e.needsTicking()).toBe(false)
    expect(e.result).toBe('guestWin')
    const left = e.clock.remainingMS
    expect(left).toBe(25 * 60 * 1000 - 60 * 1000)
    advance(30)  // clock stays frozen
    expect(e.clock.remainingMS).toBe(left)
  })

  it('ends from paused as a tie', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(10); e.toggleClock()
    goals(e, TeamSide.home, 2); goals(e, TeamSide.guest, 2)
    e.endGameNow()
    expect(e.phase).toBe(Phase.over)
    expect(e.result).toBe('tie')
  })

  it('ends from the half-time break without starting the next period', () => {
    const { e, advance } = make({ periodMS: 60_000 })
    goals(e, TeamSide.home, 1)
    e.toggleClock(); advance(61)
    expect(e.phase).toBe(Phase.breakTime)
    expect(e.breakKind).toBe(BreakKind.halftime)
    e.endGameNow()
    expect(e.phase).toBe(Phase.over)
    expect(e.breakKind).toBe(null)
    expect(e.currentHalf).toBe(Half.first)
    expect(e.clock.isRunning).toBe(false)
    expect(e.result).toBe('homeWin')
    advance(400)
    expect(e.phase).toBe(Phase.over)
  })

  it('ends from a timeout break and keeps the period clock', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(100)
    goals(e, TeamSide.guest, 1)
    e.requestTimeout(TeamSide.home)
    expect(e.phase).toBe(Phase.breakTime)
    e.endGameNow()
    expect(e.phase).toBe(Phase.over)
    expect(e.clock.isRunning).toBe(false)
    expect(e.clock.remainingMS).toBe(25 * 60 * 1000 - 100 * 1000)
    expect(e.result).toBe('guestWin')
  })

  it('is idempotent', () => {
    const { e } = make()
    goals(e, TeamSide.home, 3)
    e.endGameNow()
    const buzz = e.buzzSeq, v = { result: e.result, phase: e.phase }
    e.endGameNow()
    expect(e.buzzSeq).toBe(buzz)
    expect({ result: e.result, phase: e.phase }).toEqual(v)
  })

  it('goes through the normal game-end path (gameEnd buzz)', () => {
    const { e } = make()
    goals(e, TeamSide.home, 1)
    e.endGameNow()
    expect(e.lastBuzzKind).toBe('gameEnd')
  })

  it('survives serialize/restore as over', () => {
    const { e } = make()
    goals(e, TeamSide.home, 4); goals(e, TeamSide.guest, 1)
    e.endGameNow()
    const { e: e2 } = make()
    e2.restore(JSON.parse(JSON.stringify(e.serialize())))
    expect(e2.phase).toBe(Phase.over)
    expect(e2.result).toBe('homeWin')
    expect(e2.homeFinalScore).toBe(4)
    expect(e2.guestFinalScore).toBe(1)
  })

  describe('three-thirds', () => {
    it('credits the period in progress and saves TOTAL goals', () => {
      const { e, advance } = make({ format: GameFormat.threeThirds, periodMS: 60_000 })
      // 1st third: guest 2–0
      goals(e, TeamSide.guest, 2)
      e.toggleClock(); advance(61)
      expect(e.phase).toBe(Phase.breakTime)
      e.skipBreak()
      expect(e.currentHalf).toBe(Half.second)
      // 2nd third (in progress): home 3–0, then judge ends it
      goals(e, TeamSide.home, 3)
      e.endGameNow()
      expect(e.phase).toBe(Phase.over)
      expect(e.guest.thirds).toBe(1)
      expect(e.home.thirds).toBe(1)
      expect(e.result).toBe('tie')
      expect(e.homeFinalScore).toBe(3)
      expect(e.guestFinalScore).toBe(2)
    })

    it('does not double-credit a third when ended from the break after it', () => {
      const { e, advance } = make({ format: GameFormat.threeThirds, periodMS: 60_000 })
      goals(e, TeamSide.home, 1)
      e.toggleClock(); advance(61)
      expect(e.home.thirds).toBe(1)
      e.endGameNow()
      expect(e.home.thirds).toBe(1)
      expect(e.guest.thirds).toBe(0)
      expect(e.result).toBe('homeWin')
    })

    it('ready-with-goals in the first third counts that third', () => {
      const { e } = make({ format: GameFormat.threeThirds })
      goals(e, TeamSide.guest, 1)
      e.endGameNow()
      expect(e.guest.thirds).toBe(1)
      expect(e.result).toBe('guestWin')
      expect(e.guestFinalScore).toBe(1)
    })
  })
})
