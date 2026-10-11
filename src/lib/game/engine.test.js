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

// ---- clock / judge-board fixes (2026-10-11) ----
function makeWall(settingsPatch = {}) {
  let t = 1000            // monotonic seconds
  let wall = 1_700_000_000_000
  const settings = { ...defaultSettings(), ...settingsPatch }
  const e = new GameEngine({ settings, now: () => t, wallNow: () => wall })
  const advance = (sec) => { t += sec; wall += sec * 1000; if (e.needsTicking()) e.tick() }
  const fresh = () => new GameEngine({ settings: defaultSettings(), now: () => t, wallNow: () => wall })
  const passWall = (sec) => { wall += sec * 1000 }
  return { e, advance, fresh, passWall }
}
const roundTrip = (e, into) => { into.restore(JSON.parse(JSON.stringify(e.serialize()))); return into }

describe('timeouts only while a period is in play (fix 1)', () => {
  it('refuses a timeout during a timeout break and keeps the game clock', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(100)
    expect(e.requestTimeout(TeamSide.home)).toBe(true)
    expect(e.canTimeout(TeamSide.guest)).toBe(false)
    expect(e.requestTimeout(TeamSide.guest)).toBe(false)
    expect(e.guest.timeoutsThisPeriod).toBe(0)
    e.skipBreak()
    expect(e.phase).toBe(Phase.paused)
    expect(e.clock.remainingMS).toBe(25 * 60_000 - 100_000)
  })

  it('refuses a timeout during halftime, ready and over', () => {
    const { e, advance } = make({ periodMS: 60_000 })
    expect(e.canTimeout(TeamSide.home)).toBe(false)          // ready
    e.toggleClock(); advance(61)
    expect(e.breakKind).toBe(BreakKind.halftime)
    expect(e.requestTimeout(TeamSide.home)).toBe(false)
    e.skipBreak()
    expect(e.currentHalf).toBe(Half.second)
    expect(e.clock.remainingMS).toBe(60_000)
    e.endGameNow()
    expect(e.canTimeout(TeamSide.home)).toBe(false)
  })

  it('allows a timeout from paused', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(5); e.toggleClock()
    expect(e.requestTimeout(TeamSide.guest)).toBe(true)
  })
})

describe('reload during a break (fix 2)', () => {
  it('resumes a timeout against its wall-clock deadline and keeps the game clock', () => {
    const { e, advance, fresh, passWall } = makeWall()
    e.toggleClock(); advance(100)
    e.requestTimeout(TeamSide.home)
    advance(20)                                   // 40s of the 60s timeout left
    const snap = JSON.parse(JSON.stringify(e.serialize()))
    passWall(10)                                  // page away for 10s
    const e2 = fresh(); e2.restore(snap)
    expect(e2.phase).toBe(Phase.breakTime)
    expect(e2.breakKind).toBe(BreakKind.homeTimeout)
    expect(e2.clock.remainingMS).toBe(30_000)
    expect(e2.clock.isRunning).toBe(true)
    e2.skipBreak()
    expect(e2.phase).toBe(Phase.paused)
    expect(e2.clock.remainingMS).toBe(25 * 60_000 - 100_000)
  })

  it('a timeout whose deadline passed while away ends with the game clock restored', () => {
    const { e, advance, fresh, passWall } = makeWall()
    e.toggleClock(); advance(100)
    e.requestTimeout(TeamSide.guest)
    const snap = JSON.parse(JSON.stringify(e.serialize()))
    passWall(120)
    const e2 = fresh(); e2.restore(snap)
    expect(e2.phase).toBe(Phase.paused)
    expect(e2.breakKind).toBe(null)
    expect(e2.clock.remainingMS).toBe(25 * 60_000 - 100_000)
    expect(e2.guest.timeoutsThisPeriod).toBe(1)
  })

  it('halftime: resumes the break, then the next half starts at full length', () => {
    const { e, advance, fresh, passWall } = makeWall({ periodMS: 60_000 })
    e.toggleClock(); advance(61)
    expect(e.breakKind).toBe(BreakKind.halftime)
    const snap = JSON.parse(JSON.stringify(e.serialize()))
    passWall(60)
    const e2 = fresh(); e2.restore(snap)
    expect(e2.phase).toBe(Phase.breakTime)
    expect(e2.breakKind).toBe(BreakKind.halftime)
    expect(e2.clock.remainingMS).toBe(5 * 60_000 - 60_000)
    passWall(400)
    const e3 = fresh(); e3.restore(snap)
    expect(e3.phase).toBe(Phase.ready)
    expect(e3.currentHalf).toBe(Half.second)
    expect(e3.clock.remainingMS).toBe(60_000)
  })

  it('a running game clock is still restored paused', () => {
    const { e, advance, fresh } = makeWall()
    e.toggleClock(); advance(30)
    const e2 = roundTrip(e, fresh())
    expect(e2.phase).toBe(Phase.paused)
    expect(e2.clock.remainingMS).toBe(25 * 60_000 - 30_000)
  })
})

describe('penalty cards are ms-precise (fix 6)', () => {
  it('loses nothing across many sub-second pauses', () => {
    const { e, advance } = make()
    e.toggleClock()
    e.addCard(TeamSide.home, { id: 'p1', number: 7 }, 'blue')
    // 10 × (0.7s running, pause, resume)
    for (let i = 0; i < 10; i++) { advance(0.7); e.toggleClock(); e.toggleClock() }
    const c = e.cards[0]
    expect(c.remainingMS).toBe(120_000 - 7_000)
    expect(e.clock.remainingMS).toBe(25 * 60_000 - 7_000)
  })

  it('runs only with the game clock — not during a timeout', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(1.5)
    e.addCard(TeamSide.guest, null, 'red')
    advance(10.25)
    e.requestTimeout(TeamSide.home)
    advance(30)
    expect(e.cards[0].remainingMS).toBe(240_000 - 10_250)
    e.skipBreak(); e.toggleClock(); advance(0.75)
    expect(e.cards[0].remainingMS).toBe(240_000 - 11_000)
    expect(e.cards[0].remainingS).toBe(229)
  })

  it('expires exactly and survives a restore of an old whole-second draft', () => {
    const { e, advance } = make()
    e.toggleClock()
    e.addCard(TeamSide.home, null, 'blue')
    advance(119.9)
    expect(e.cards.length).toBe(1)
    advance(0.1)
    expect(e.cards.length).toBe(0)
    expect(e.cardLog.length).toBe(1)
    const snap = JSON.parse(JSON.stringify(e.serialize()))
    snap.cards = [{ id: 'eold-1', side: 'home', type: 'blue', remainingS: 50, half: 'first', player: null }]
    const { e: e2 } = make(); e2.restore(snap)
    expect(e2.cards[0].remainingMS).toBe(50_000)
  })
})

describe('events during a break get the game time (fix 8)', () => {
  it('during a timeout: the interrupted period time', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(100)
    e.requestTimeout(TeamSide.home)
    advance(20)
    e.addStrike(TeamSide.guest)
    e.addGoal(TeamSide.home)
    e.addCard(TeamSide.home, null, 'blue')
    const want = 25 * 60_000 - 100_000
    expect(e.strikes[0].timeMS).toBe(want)
    expect(e.goals[0].timeMS).toBe(want)
    expect(e.cardLog[0].timeMS).toBe(want)
  })

  it('during halftime: end of the half just played', () => {
    const { e, advance } = make({ periodMS: 60_000 })
    e.toggleClock(); advance(61)
    advance(30)
    e.addStrike(TeamSide.home)
    expect(e.strikes[0].timeMS).toBe(0)
    expect(e.strikes[0].half).toBe(Half.first)
  })
})

describe('undo a mis-tapped timeout (fix 9)', () => {
  it('ends the running timeout break and restores the clock + counter', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(100)
    e.requestTimeout(TeamSide.home)
    advance(5)
    expect(e.removeTimeout(TeamSide.home)).toBe(true)
    expect(e.phase).toBe(Phase.paused)
    expect(e.breakKind).toBe(null)
    expect(e.clock.remainingMS).toBe(25 * 60_000 - 100_000)
    expect(e.home.timeoutsThisPeriod).toBe(0)
    expect(e.breaks.length).toBe(0)
  })

  it('removes an earlier timeout of that side from the log after its break', () => {
    const { e, advance } = make()
    e.toggleClock(); advance(10)
    e.requestTimeout(TeamSide.guest); e.skipBreak()
    e.requestTimeout(TeamSide.guest); e.skipBreak()
    expect(e.canTimeout(TeamSide.guest)).toBe(false)
    expect(e.removeTimeout(TeamSide.guest)).toBe(true)
    expect(e.guest.timeoutsThisPeriod).toBe(1)
    expect(e.canTimeout(TeamSide.guest)).toBe(true)
    expect(e.breaks.filter(b => b.kind === BreakKind.guestTimeout).length).toBe(1)
    expect(e.removeTimeout(TeamSide.home)).toBe(false)
  })

  it('does nothing during halftime or for a previous period', () => {
    const { e, advance } = make({ periodMS: 60_000 })
    e.toggleClock(); advance(10)
    e.requestTimeout(TeamSide.home); e.skipBreak()
    e.toggleClock(); advance(60)
    expect(e.breakKind).toBe(BreakKind.halftime)
    expect(e.removeTimeout(TeamSide.home)).toBe(false)
    e.skipBreak()
    expect(e.removeTimeout(TeamSide.home)).toBe(false)
    expect(e.home.timeoutsThisPeriod).toBe(0)
  })
})

describe('overtime (fix 5)', () => {
  it('is off by default', () => {
    const { e, advance } = make({ periodMS: 60_000 })
    e.toggleClock(); advance(61); e.skipBreak()
    e.toggleClock(); advance(61)
    expect(e.phase).toBe(Phase.over)
    expect(e.result).toBe('tie')
  })

  it('uses the overtime period length, not a half', () => {
    const { e, advance } = make({ periodMS: 60_000, overtimeEnabled: true })
    e.toggleClock(); advance(61); e.skipBreak()
    e.toggleClock(); advance(61); e.skipBreak()
    expect(e.currentHalf).toBe(Half.ot1)
    expect(e.phase).toBe(Phase.readyOvertime)
    expect(e.clock.remainingMS).toBe(5 * 60_000)
    e.setOvertimeLength(3 * 60_000)
    expect(e.clock.remainingMS).toBe(3 * 60_000)
  })
})

describe('red card removal', () => {
  it('returns the card and un-ejects only when no other red stands', () => {
    const { e } = make()
    const p = { id: 'p9', number: 9 }
    e.addCard(TeamSide.home, p, 'red')
    const removed = e.removeCard(e.cardLog[0].id)
    expect(removed.type).toBe('red')
    expect(e.isEjected('p9')).toBe(false)
    expect(e.hasRedCard('p9')).toBe(false)
  })
})
