// The match brain: owns the clock, drives the period/overtime/break state machine,
// passive-play clock, event-based scoring, penalty cards, timeouts and buzzer.
// Faithful port of HockeyTimer-iOS Sources/Shared/Engine/GameEngine.swift.
//
// Framework-agnostic: mutations bump `version` and notify subscribers; a React
// hook drives tick() ~30fps and re-renders on version change. Score/strikes are
// DERIVED from event rows (never edited) — kills the drift bugs of the original.
import { CountdownClock, monotonicNow } from './clock'
import {
  GameRules, GameFormat, Half, isOvertime, Phase, BreakKind,
  CardType, cardBaseSeconds, TeamSide, defaultSettings, halfBreakMS, periodLengthMS,
  BuzzKind, isPenaltyFoul, isWarningFoul,
} from './rules'

// Event ids must stay unique across page reloads: restore() rehydrates events minted
// in a previous session, so a bare counter would re-issue ids that already exist and
// removeCard(id) could delete the wrong card.
let _uid = 0
const _session = Math.random().toString(36).slice(2, 8)
const uid = () => `e${_session}-${++_uid}`
// Numeric suffix of an event id (`e<session>-<n>`). The live feed orders events by
// this, so restore() must keep _uid ahead of any restored event — the counter
// restarts each session and its suffix would otherwise collide with older events.
const _suffixOf = (id) => { const m = /-(\d+)$/.exec(id || ''); return m ? +m[1] : 0 }

const HE = {
  halftime: 'מנוחה',
  tie: 'תיקו',
  timeoutFor: (n) => `פסק זמן — ${n}`,
  wins: (n) => `${n} ניצחה`,
  ot: (n) => `הארכה ${n}`,
}

function makeSide(name) {
  return { name, score: 0, strikes: 0, thirds: 0, timeoutsThisPeriod: 0 }
}

// Penalty cards count down in MILLISECONDS on the game clock's own timeline (see
// _syncCards). `remainingS` is the whole-second display value, kept on the object for
// older drafts/snapshots that only knew that field.
function setCardMS(card, ms) {
  card.remainingMS = Math.max(0, ms)
  card.remainingS = Math.ceil(card.remainingMS / 1000)
}
const cardMS = (c) => (Number.isFinite(c.remainingMS) ? c.remainingMS : (c.remainingS ?? 0) * 1000)

export class GameEngine {
  constructor({ settings = defaultSettings(), homeName = 'בית', guestName = 'חוץ', now = monotonicNow, wallNow = Date.now } = {}) {
    this.settings = settings
    this.now = now
    // Wall-clock ms (epoch). Only for a break deadline that must survive a page reload —
    // the monotonic clock restarts with the page.
    this.wallNow = wallNow
    this.clock = new CountdownClock(settings.periodMS, now)
    this.clock.onExpire = () => this._clockDidExpire()

    this.phase = Phase.ready
    this.currentHalf = Half.first
    this.breakKind = null
    this.result = null

    this.home = makeSide(homeName)
    this.guest = makeSide(guestName)

    this.goals = []
    this.strikes = []
    this.cards = []          // ACTIVE penalty cards (live countdown; pruned on expiry)
    this.cardLog = []        // every card ISSUED (never pruned) — source for the box score
    this.breaks = []         // timeouts + period breaks, for the live play-by-play
    this.ejected = new Set()
    this.buzzSeq = 0
    this.lastBuzzKind = BuzzKind.manual

    this.passiveRemainingMS = GameRules.passiveSeconds * 1000
    this.passiveActive = true

    this.onBuzz = null
    this.onChange = null

    this._pendingHalf = null
    this._preBreakRemainingMS = 0
    this._passiveDeadline = 0
    // Game-clock remainingMS at the last card sync while the game clock runs; null when
    // the game clock is stopped (paused, break, ready…) so cards don't move.
    this._cardAnchorMS = null

    this._subs = new Set()
    this.version = 0
  }

  // ---- subscription / notify ----
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn) }
  _emit() { this.version++; for (const fn of this._subs) fn() }
  _changed() { this.onChange && this.onChange(); this._emit() }
  _side(s) { return s === TeamSide.home ? this.home : this.guest }

  // ---- derived display ----
  get periodLabel() {
    if (this.phase === Phase.breakTime) {
      if (this.breakKind === BreakKind.homeTimeout) return HE.timeoutFor(this.home.name)
      if (this.breakKind === BreakKind.guestTimeout) return HE.timeoutFor(this.guest.name)
      return HE.halftime
    }
    if (this.phase === Phase.over) {
      if (this.result === 'homeWin') return HE.wins(this.home.name)
      if (this.result === 'guestWin') return HE.wins(this.guest.name)
      return HE.tie
    }
    switch (this.currentHalf) {
      case Half.first: return '1'
      case Half.second: return '2'
      case Half.third: return '3'
      case Half.ot1: return HE.ot(1)
      case Half.ot2: return HE.ot(2)
      default: return ''
    }
  }
  get passiveSeconds() { return Math.ceil(this.passiveRemainingMS / 1000) }
  get passiveIsWarning() { return this.settings.passivePlayEnabled && this.passiveSeconds <= GameRules.passiveFlashAt }
  get isRunning() { return this.phase === Phase.running }
  get homeDisplayScore() { return (this.phase === Phase.over && this.settings.format === GameFormat.threeThirds) ? this.home.thirds : this.home.score }
  get guestDisplayScore() { return (this.phase === Phase.over && this.settings.format === GameFormat.threeThirds) ? this.guest.thirds : this.guest.score }

  // Goals over the WHOLE match. In threeThirds, side.score only counts the current
  // period, so persistence must use these instead — they always agree with boxScore().
  totalGoals(side) { return this.goals.filter(g => g.side === side).length }
  get homeFinalScore() { return this.totalGoals(TeamSide.home) }
  get guestFinalScore() { return this.totalGoals(TeamSide.guest) }

  // Active cards for a side, most-recent first, capped at 2 for display.
  activeCards(side) { return this.cards.filter(c => c.side === side).slice(-2).reverse() }
  isEjected(id) { return this.ejected.has(id) }

  // ---- primary controls ----
  toggleClock() {
    if (this.phase === Phase.ready || this.phase === Phase.readyOvertime || this.phase === Phase.paused) {
      if (this.clock.remainingMS <= 0) return
      this.clock.start()
      this.phase = Phase.running
      this._cardAnchorMS = this.clock.remainingMS
      this.resetPassive()
    } else if (this.phase === Phase.running) {
      this.clock.pause()
      this._syncCards(true)   // keep the partial second the cards ran before the pause
      this.phase = Phase.paused
    } else return
    this._changed()
  }

  startBreak(kind, seconds) {
    // Recompute from the monotonic deadline first: a running clock's cached remainingMS
    // lags by up to one ~50ms tick, and that stale value is what we resume after the
    // break — so without this the game clock gains a little time on every timeout.
    // `pause()` and not `refresh()`: both recompute, but refresh fires `onExpire` at
    // zero, which re-enters this method through `_periodDidEnd` and clobbers the break
    // we are in the middle of starting. The clock is stopped a few lines below anyway.
    this.clock.pause()
    this._syncCards(true)
    this._preBreakRemainingMS = this.clock.remainingMS
    this.breaks.push({
      id: uid(), kind,
      side: kind === BreakKind.homeTimeout ? TeamSide.home : kind === BreakKind.guestTimeout ? TeamSide.guest : null,
      timeMS: this._preBreakRemainingMS, half: this.currentHalf,
    })
    this.breakKind = kind
    this.phase = Phase.breakTime
    this.clock.set(seconds * 1000)
    this.clock.start()
    this.buzz(BuzzKind.breakStart)
    this._changed()
  }

  skipBreak() {
    if (this.phase !== Phase.breakTime) return
    this.clock.set(0)
    this._breakDidEnd()
  }

  beginEditing() {
    if (this.phase === Phase.breakTime) return   // a break's clock isn't the game clock
    this.clock.pause(); this._syncCards(true); this.phase = Phase.editing; this._changed()
  }
  endEditing() { this.phase = isOvertime(this.currentHalf) ? Phase.readyOvertime : Phase.ready; this._changed() }

  setPeriodLength(ms) {
    this.settings.periodMS = Math.max(0, ms)
    if (this.phase === Phase.editing || this.phase === Phase.ready || this.phase === Phase.readyOvertime) {
      this.clock.set(this.settings.periodMS)
    }
    this._changed()
  }
  // Overtime period length (settings). An overtime period not yet started picks it up.
  setOvertimeLength(ms) {
    this.settings.overtimePeriodMS = Math.max(60_000, ms)
    if (this.phase === Phase.readyOvertime) this.clock.set(this.settings.overtimePeriodMS)
    this._changed()
  }

  resetGame() {
    this.clock.set(this.settings.periodMS)
    this.phase = Phase.ready
    this.currentHalf = Half.first
    this.breakKind = null
    this._pendingHalf = null
    this.result = null
    this.goals = []; this.strikes = []; this.cards = []; this.cardLog = []; this.breaks = []; this.ejected = new Set()
    this._cardAnchorMS = null
    this._preBreakRemainingMS = 0
    this.home = makeSide(this.home.name)
    this.guest = makeSide(this.guest.name)
    this.resetPassive()
    this._changed()
  }

  // Never-touched board: no events recorded and still in the opening ready phase.
  // Gates two safety checks — skipping an empty live broadcast, and rehydrating from
  // a server snapshot without clobbering officiating already begun on this board.
  isPristine() {
    return this.phase === Phase.ready &&
      this.goals.length === 0 && this.strikes.length === 0 &&
      this.cardLog.length === 0 && this.breaks.length === 0
  }

  // Something has happened on this board: an event was recorded, or the clock has been
  // started at least once (any phase past the opening ready — or a later period).
  // Gates the judge's "end game now" control, which a pristine board must not offer.
  hasActivity() {
    if (this.goals.length || this.strikes.length || this.cardLog.length || this.breaks.length) return true
    if (this.currentHalf !== Half.first) return true
    return this.phase === Phase.running || this.phase === Phase.paused ||
      this.phase === Phase.breakTime || this.phase === Phase.readyOvertime || this.phase === Phase.over
  }
  canEndNow() { return this.phase !== Phase.over && this.phase !== Phase.editing && this.hasActivity() }

  // Judge ends the match early ("סיום משחק"): game stopped, played on paper and keyed in
  // afterwards, or a clock nobody ran. Stops the clock and goes through the SAME
  // end-of-game path as the final period running out, so result + save are unchanged.
  // Idempotent: a second call on an over board does nothing.
  endGameNow() {
    if (this.phase === Phase.over) return
    if (this.phase === Phase.breakTime) {
      // Leave the break without firing its end (that would start the next period).
      // A timeout interrupted a period still in play → restore its clock; a halftime
      // break sits between periods whose time ran out.
      const timeout = this.breakKind === BreakKind.homeTimeout || this.breakKind === BreakKind.guestTimeout
      this.clock.set(timeout ? this._preBreakRemainingMS : 0)
      // Three-thirds: a halftime break's period was already credited by _periodDidEnd.
      if (timeout) this._creditCurrentThird()
    } else {
      // pause() (not refresh) — refresh would fire onExpire at zero and re-enter the
      // period machine. A clock that never ran is already stopped.
      this.clock.pause()
      this._syncCards(true)
      this._creditCurrentThird()
    }
    this._pendingHalf = null
    this._endGame()
  }
  // Three-thirds: the period in progress counts as played, exactly as _periodDidEnd
  // would credit it — otherwise ending early during a period would drop its winner.
  _creditCurrentThird() {
    if (this.settings.format !== GameFormat.threeThirds) return
    this._recomputeDerived()
    const w = this._winnerOfPeriod()
    if (w === TeamSide.home) this.home.thirds += 1
    else if (w === TeamSide.guest) this.guest.thirds += 1
  }

  // Game time an event is stamped with. During a break the clock shows the BREAK
  // countdown, so use the game clock as it stood when the break began: a timeout's
  // interrupted period time, or 0 (end of the half) for a halftime break — the event
  // belongs to the half that just ended (currentHalf only advances when the break ends).
  _eventTimeMS() {
    return this.phase === Phase.breakTime ? this._preBreakRemainingMS : this.clock.remainingMS
  }

  // ---- scoring (event-based) ----
  // `side` is always the side the goal COUNTS for. An own goal (`{ ownGoal: true }`) is
  // credited to the side that benefits — an away player putting it in his own net is
  // addGoal(home, null, { ownGoal: true }) — and never names a scorer.
  addGoal(side, player = null, { ownGoal = false } = {}) {
    const g = { id: uid(), side, player: ownGoal ? null : player, timeMS: this._eventTimeMS(), half: this.currentHalf }
    if (ownGoal) g.ownGoal = true
    this.goals.push(g)
    this._recomputeDerived()
    if (this.phase === Phase.running) this.buzz(BuzzKind.goal)
    this._changed()
  }
  removeGoal(side) {
    for (let i = this.goals.length - 1; i >= 0; i--) {
      if (this.goals[i].side === side) { this.goals.splice(i, 1); this._recomputeDerived(); this._changed(); return }
    }
  }
  addStrike(side, player = null) {
    this.strikes.push({ id: uid(), side, player, timeMS: this._eventTimeMS(), half: this.currentHalf })
    this._recomputeDerived()
    // Play usually stops for a foul, so the judge records it as often from a paused
    // clock as from a running one. Alert whenever the match is under way; only the
    // setup and post-game phases stay silent.
    if (this.phase !== Phase.editing && this.phase !== Phase.over) {
      const count = this._side(side).strikes
      if (isPenaltyFoul(count)) this.buzz(BuzzKind.teamFoulPenalty)
      else if (isWarningFoul(count)) this.buzz(BuzzKind.teamFoulWarning)
    }
    this._changed()
  }
  removeStrike(side) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      if (this.strikes[i].side === side) { this.strikes.splice(i, 1); this._recomputeDerived(); this._changed(); return }
    }
  }

  // ---- penalty cards ----
  addCard(side, player, type) {
    // Bring running cards up to date first, so the new card starts from this instant.
    this._syncCards()
    const card = { id: uid(), side, player, type, timeMS: this._eventTimeMS(), half: this.currentHalf }
    setCardMS(card, cardBaseSeconds(type) * 1000)
    // A red card replaces the player's ACTIVE card (countdown) and ejects them,
    // but both cards still count in the box score (cardLog keeps them).
    if (type === CardType.red && player?.id != null) {
      this.cards = this.cards.filter(c => c.player?.id !== player.id)
      this.ejected.add(player.id)
    }
    this.cards.push(card)
    this.cardLog.push(card)
    this.buzz(BuzzKind.card)
    this._changed()
  }
  // Manual correction of a mistaken card: remove from both active list and the log.
  // Returns the removed card (or null) so the caller can undo its side effects (a red
  // card's suspension).
  removeCard(id) {
    const card = this.cards.find(c => c.id === id) || this.cardLog.find(c => c.id === id)
    if (!card) return null
    this.cards = this.cards.filter(c => c.id !== id)
    this.cardLog = this.cardLog.filter(c => c.id !== id)
    // Still ejected if ANOTHER red card for the same player stands.
    if (card.type === CardType.red && card.player?.id != null &&
        !this.cardLog.some(c => c.type === CardType.red && c.player?.id === card.player.id)) {
      this.ejected.delete(card.player.id)
    }
    this._changed()
    return card
  }
  /** Does the log still hold a red card for this player? */
  hasRedCard(playerId) {
    return playerId != null && this.cardLog.some(c => c.type === CardType.red && c.player?.id === playerId)
  }

  // ---- timeouts ----
  // Only while a period is in play (running or paused). During a break the clock holds
  // the break countdown — a timeout there used to overwrite the saved game time with it.
  requestTimeout(side) {
    if (!this.canTimeout(side)) return false
    const used = this._side(side).timeoutsThisPeriod
    // The first timeout a team takes in a period is a full minute; the second is 30s.
    const seconds = GameRules.timeoutSeconds(used + 1)
    this._side(side).timeoutsThisPeriod += 1
    this.startBreak(side === TeamSide.home ? BreakKind.homeTimeout : BreakKind.guestTimeout, seconds)
    return true
  }
  canTimeout(side) {
    if (this.phase !== Phase.running && this.phase !== Phase.paused) return false
    return this._side(side).timeoutsThisPeriod < GameRules.maxTimeoutsPerPeriod
  }
  // Undo a mis-tapped timeout: the side's most recent timeout in the current period
  // leaves the log and the counter. If that timeout is the break running now, the break
  // ends silently and the game clock returns to where it stopped. Not during halftime
  // (the counters have already reset for the next period).
  canUndoTimeout(side) { return this._lastTimeoutIndex(side) >= 0 }
  _lastTimeoutIndex(side) {
    if (this.phase === Phase.breakTime && this.breakKind === BreakKind.halftime) return -1
    const kind = side === TeamSide.home ? BreakKind.homeTimeout : BreakKind.guestTimeout
    for (let i = this.breaks.length - 1; i >= 0; i--) {
      const b = this.breaks[i]
      if (b.kind === kind && b.half === this.currentHalf) return i
    }
    return -1
  }
  removeTimeout(side) {
    const i = this._lastTimeoutIndex(side)
    if (i < 0) return false
    const kind = this.breaks[i].kind
    const isLastBreak = i === this.breaks.length - 1
    this.breaks.splice(i, 1)
    const s = this._side(side)
    s.timeoutsThisPeriod = Math.max(0, s.timeoutsThisPeriod - 1)
    if (this.phase === Phase.breakTime && this.breakKind === kind && isLastBreak) {
      this.clock.set(this._preBreakRemainingMS)
      this.phase = Phase.paused
      this.breakKind = null
    }
    this._changed()
    return true
  }

  // ---- passive play ----
  resetPassive() {
    this.passiveRemainingMS = GameRules.passiveSeconds * 1000
    this._passiveDeadline = this.now() + GameRules.passiveSeconds
    // Audible cue that the 45s clock is armed. Only while play is actually running and
    // passive play is on: resetGame() also lands here (it sets phase = ready first), and
    // a board reset must not sound, nor must a league that has passive play switched off.
    if (this.phase === Phase.running && this.settings.passivePlayEnabled) {
      this.buzz(BuzzKind.passiveStart)
    }
  }

  buzz(kind = BuzzKind.manual) {
    this.buzzSeq++
    this.lastBuzzKind = kind
    this.onBuzz && this.onBuzz(kind)
    this._changed()
  }

  // ---- derivation ----
  _recomputeDerived() {
    this.home.score = this._scoreFor(TeamSide.home); this.home.strikes = this._strikeCount(TeamSide.home)
    this.guest.score = this._scoreFor(TeamSide.guest); this.guest.strikes = this._strikeCount(TeamSide.guest)
  }
  _scoreFor(side) {
    if (this.settings.format === GameFormat.threeThirds) {
      return this.goals.filter(g => g.side === side && g.half === this.currentHalf).length
    }
    return this.goals.filter(g => g.side === side).length
  }
  _strikeCount(side) { return this.strikes.filter(s => s.side === side).length }

  // ---- state machine ----
  _clockDidExpire() {
    if (this.phase === Phase.breakTime) this._breakDidEnd()
    else if (this.phase === Phase.running) this._periodDidEnd()
  }
  _periodDidEnd() {
    this._syncCards(true)   // the clock ran out at 0: cards ran that final stretch too
    this.buzz(BuzzKind.periodEnd)
    if (this.settings.format === GameFormat.threeThirds) {
      const w = this._winnerOfPeriod()
      if (w === TeamSide.home) this.home.thirds += 1
      else if (w === TeamSide.guest) this.guest.thirds += 1
    }
    const next = this._nextHalf()
    if (!next) { this._endGame(); return }
    this._pendingHalf = next
    this.home.timeoutsThisPeriod = 0
    this.guest.timeoutsThisPeriod = 0
    this.startBreak(BreakKind.halftime, halfBreakMS(this.settings) / 1000)
  }
  _breakDidEnd({ silent = false } = {}) {
    if (!silent) this.buzz(BuzzKind.breakEnd)
    if (this.breakKind === BreakKind.halftime) {
      if (this._pendingHalf) { this.currentHalf = this._pendingHalf; this._pendingHalf = null }
      this.clock.set(periodLengthMS(this.settings, this.currentHalf))
      this.phase = isOvertime(this.currentHalf) ? Phase.readyOvertime : Phase.ready
      this._recomputeDerived()  // three-thirds: new period score shows 0
    } else if (this.breakKind === BreakKind.homeTimeout || this.breakKind === BreakKind.guestTimeout) {
      this.clock.set(this._preBreakRemainingMS)
      this.phase = Phase.paused
    } else {
      this.phase = Phase.paused
    }
    this.breakKind = null
    this._changed()
  }
  _nextHalf() {
    if (this.settings.format === GameFormat.twoHalves) {
      switch (this.currentHalf) {
        case Half.first: return Half.second
        case Half.second: {
          const tied = this.home.score === this.guest.score
          return (tied && this.settings.overtimeEnabled) ? Half.ot1 : null
        }
        case Half.ot1: return this.home.score !== this.guest.score ? null : Half.ot2
        default: return null
      }
    } else {
      switch (this.currentHalf) {
        case Half.first: return Half.second
        case Half.second: return Half.third
        default: return null
      }
    }
  }
  _winnerOfPeriod() {
    if (this.home.score > this.guest.score) return TeamSide.home
    if (this.guest.score > this.home.score) return TeamSide.guest
    return null
  }
  _endGame() {
    this.phase = Phase.over
    this.breakKind = null
    if (this.settings.format === GameFormat.twoHalves) {
      this.result = this.home.score > this.guest.score ? 'homeWin' : (this.guest.score > this.home.score ? 'guestWin' : 'tie')
    } else {
      this.result = this.home.thirds > this.guest.thirds ? 'homeWin' : (this.guest.thirds > this.home.thirds ? 'guestWin' : 'tie')
    }
    this.buzz(BuzzKind.gameEnd)
    this._changed()
  }

  // ---- ticking (driven by the app at ~30fps) ----
  needsTicking() { return this.phase === Phase.running || this.phase === Phase.breakTime }
  tick() {
    this.clock.refresh()  // may fire onExpire → period/break transitions (which emit)
    if (this.phase === Phase.running) {
      // Gate the passive-play countdown on the actual judge setting, not the internal
      // `passiveActive` flag — that flag is seeded true and never cleared, so it kept
      // decrementing passive state even when a league had passive play switched off.
      if (this.settings.passivePlayEnabled) {
        const before = this.passiveRemainingMS
        this.passiveRemainingMS = Math.max(0, Math.round((this._passiveDeadline - this.now()) * 1000))
        // Sound the expiry once, on the crossing. Testing `=== 0` alone would re-buzz on
        // every tick for as long as the clock sits at zero waiting to be re-armed.
        if (before > 0 && this.passiveRemainingMS === 0) this.buzz(BuzzKind.passiveEnd)
      }
      this._decrementCards()
    }
    this._emit()
  }
  _decrementCards() { this._syncCards() }
  // Cards run exactly as much game time as the game clock did since the last sync —
  // millisecond-precise, so pausing never drops (or adds) the partial second.
  // `stop`: the game clock has just stopped; detach until the next start.
  _syncCards(stop = false) {
    if (this._cardAnchorMS == null) return
    const nowMS = this.clock.remainingMS
    const elapsed = this._cardAnchorMS - nowMS
    this._cardAnchorMS = stop ? null : nowMS
    if (elapsed <= 0 || this.cards.length === 0) return
    const before = this.cards.map(c => c.remainingS)
    for (const c of this.cards) setCardMS(c, cardMS(c) - elapsed)
    const n = this.cards.length
    this.cards = this.cards.filter(c => c.remainingMS > 0)
    if (this.cards.length !== n || this.cards.some((c, i) => c.remainingS !== before[i])) this._changed()
  }

  // ---- box score for persistence ----
  // Aggregates goals + all issued cards (cardLog) per player. clean_sheet is left
  // to the caller (which knows rosters/positions + final score). Returns an array of
  // { player_id, goals, blue_cards, red_cards }.
  boxScore() {
    const per = new Map()
    const row = (pid) => {
      let r = per.get(pid)
      if (!r) { r = { player_id: pid, goals: 0, blue_cards: 0, red_cards: 0 }; per.set(pid, r) }
      return r
    }
    for (const g of this.goals) if (!g.ownGoal && g.player?.id != null) row(g.player.id).goals += 1
    for (const c of this.cardLog) {
      if (c.player?.id == null) continue
      if (c.type === CardType.blue) row(c.player.id).blue_cards += 1
      else row(c.player.id).red_cards += 1
    }
    return [...per.values()]
  }

  // Own goals CREDITED to each side (engine 'guest' = away), for the save's
  // p_report.ownGoals → games.home_own_goals / away_own_goals.
  ownGoals() {
    const n = (side) => this.goals.filter(g => g.ownGoal && g.side === side).length
    return { home: n(TeamSide.home), away: n(TeamSide.guest) }
  }

  // ---- mid-game persistence (localStorage) ----
  serialize() {
    return {
      settings: this.settings,
      phase: this.phase, currentHalf: this.currentHalf, breakKind: this.breakKind, result: this.result,
      home: this.home, guest: this.guest,
      goals: this.goals, strikes: this.strikes, cards: this.cards, cardLog: this.cardLog, breaks: this.breaks,
      ejected: [...this.ejected],
      clockRemainingMS: this.clock.remainingMS,
      passiveRemainingMS: this.passiveRemainingMS, passiveActive: this.passiveActive,
      pendingHalf: this._pendingHalf, preBreakRemainingMS: this._preBreakRemainingMS,
      // A break keeps counting while the page is away: its wall-clock end lets restore()
      // resume (or finish) it. Null outside a break.
      breakEndsAt: this.phase === Phase.breakTime ? this.wallNow() + this.clock.remainingMS : null,
    }
  }
  // Restore a saved match. A live clock/break is restored PAUSED (the app was away).
  // A break (timeout / halftime) is the exception: it is real-world time, so it resumes
  // against its wall-clock deadline, or — if that has passed — ends as it would have.
  restore(s) {
    if (!s) return
    // Merge over defaults: drafts from older builds lack newer settings (overtimePeriodMS).
    this.settings = s.settings ? { ...defaultSettings(), ...s.settings } : this.settings
    this.currentHalf = s.currentHalf || Half.first
    this.breakKind = null
    this.result = s.result || null
    this.home = s.home || this.home
    this.guest = s.guest || this.guest
    this.goals = s.goals || []; this.strikes = s.strikes || []
    this.cards = s.cards || []; this.cardLog = s.cardLog || []; this.breaks = s.breaks || []
    // Older drafts counted cards in whole seconds only.
    for (const c of this.cards) setCardMS(c, cardMS(c))
    // An active card and its cardLog entry are one object in a live engine — JSON splits
    // them. Re-link so a removal or countdown touches both.
    const logById = new Map(this.cardLog.map(c => [c.id, c]))
    this.cards = this.cards.map(c => { const l = logById.get(c.id); if (l) { Object.assign(l, c); return l } return c })
    this._cardAnchorMS = null
    // Keep the id counter ahead of every restored event so post-restore events
    // sort AFTER them in the live feed (the counter restarts each session).
    for (const e of [...this.goals, ...this.strikes, ...this.cardLog, ...this.breaks]) {
      const n = _suffixOf(e.id); if (n > _uid) _uid = n
    }
    this.ejected = new Set(s.ejected || [])
    this.passiveRemainingMS = s.passiveRemainingMS ?? GameRules.passiveSeconds * 1000
    this.passiveActive = s.passiveActive ?? true
    this._pendingHalf = s.pendingHalf || null
    this._preBreakRemainingMS = s.preBreakRemainingMS || 0
    this._recomputeDerived()
    const breakKind = s.breakKind || (s.phase === Phase.breakTime ? BreakKind.halftime : null)
    if (s.phase === Phase.breakTime && breakKind) {
      // The saved clock is the BREAK countdown; the game clock is preBreakRemainingMS.
      this.breakKind = breakKind
      this.phase = Phase.breakTime
      const left = Number.isFinite(s.breakEndsAt)
        ? s.breakEndsAt - this.wallNow()
        : (s.clockRemainingMS ?? 0)   // older draft: no deadline — resume what was left
      if (left > 0) {
        this.clock.set(left)
        this.clock.start()
      } else {
        this.clock.set(0)
        this._breakDidEnd({ silent: true })
      }
    } else {
      this.clock.set(s.clockRemainingMS ?? this.settings.periodMS)
      this.phase = s.phase === Phase.running ? Phase.paused : (s.phase || Phase.ready)
    }
    this._emit()
  }
}
