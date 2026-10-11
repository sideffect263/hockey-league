// Fixed rule constants + operator-configurable settings for the game engine.
// Ported from HockeyTimer-iOS Sources/Shared/Model/GameRules.swift (the faithful,
// bug-fixed rebuild of the Android original). See REBUILD-SPEC.md.

export const GameRules = {
  blueCardSeconds: 120,          // 2:00
  redCardSeconds: 240,           // 4:00
  // NO additive card stacking (owner decision 2026-07-10) — each card is an independent
  // concurrent timer, matching real rink hockey; the Android extend-one-timer model was a
  // UI simplification, not a rule. Do not restore it.
  passiveSeconds: 45,
  passiveFlashAt: 10,
  maxTimeoutsPerPeriod: 2,
  // EVERY timeout is a full minute, first or second (owner decision 2026-08-15). This
  // reverses the 30s second timeout introduced 2026-07-13 — do not restore it. The two
  // constants and timeoutSeconds(n) are kept rather than collapsed to one number so the
  // rule can differ again by editing a value, not by reintroducing a branch.
  firstTimeoutSeconds: 60,
  secondTimeoutSeconds: 60,
  // Break length for the n-th timeout a team takes in a period (n is 1-based).
  timeoutSeconds(n) {
    return n <= 1 ? GameRules.firstTimeoutSeconds : GameRules.secondTimeoutSeconds
  },
  // Team fouls ACCUMULATE for the whole game — never reset per period, and they carry
  // into overtime. The other team is awarded a penalty (free hit) on the 10th foul and
  // every 5th foul after it; a warning fires one foul earlier.
  // The Android original was CORRECT (`strikeCount > 5 && %5 === 0` -> 10, 15, 20, never
  // 5). The Swift port misread that as an off-by-one bug and regressed to every multiple
  // of 5. Rule re-confirmed with the product owner 2026-07-10.
  teamFoulPenaltyStart: 10,
  teamFoulPenaltyEvery: 5,
  showTenthsBelowMS: 60_000,     // show a tenths digit inside the final minute
  resetDoubleTapWindowMS: 300,
  // League default confirmed with the product owner (2026-07-09): 25:00.
  defaultPeriodMS: 25 * 60 * 1000,
  defaultOvertimePeriodMS: 5 * 60 * 1000,
}

/** Length of a play segment: overtime periods have their own (shorter) length. */
export const periodLengthMS = (settings, half) =>
  (half === 'ot1' || half === 'ot2')
    ? (settings.overtimePeriodMS ?? GameRules.defaultOvertimePeriodMS)
    : settings.periodMS

/** True when the n-th foul against a side awards the OTHER side a penalty: 10, 15, 20, 25… */
export function isPenaltyFoul(n) {
  return n >= GameRules.teamFoulPenaltyStart &&
    (n - GameRules.teamFoulPenaltyStart) % GameRules.teamFoulPenaltyEvery === 0
}

/** True when the n-th foul is the last one before a penalty: 9, 14, 19, 24… */
export function isWarningFoul(n) { return isPenaltyFoul(n + 1) }

// Why the buzzer sounded. The Watch maps each kind to its own haptic pattern so a judge
// can tell a foul warning from a penalty without looking (MOBILE-BUILD/WATCH-SPEC.md §6).
export const BuzzKind = {
  manual: 'manual',
  goal: 'goal',
  card: 'card',
  teamFoulWarning: 'teamFoulWarning',   // 9, 14, 19…
  teamFoulPenalty: 'teamFoulPenalty',   // 10, 15, 20…
  periodEnd: 'periodEnd',
  breakStart: 'breakStart',
  breakEnd: 'breakEnd',
  gameEnd: 'gameEnd',
  passiveStart: 'passiveStart',         // 45s passive clock armed during play
  passiveEnd: 'passiveEnd',             // …and run down to 0
}

// Match formats.
export const GameFormat = { twoHalves: 'twoHalves', threeThirds: 'threeThirds' }

// Operator-configurable, persisted per game.
export function defaultSettings() {
  return {
    periodMS: GameRules.defaultPeriodMS,   // 25:00
    format: GameFormat.twoHalves,
    // Off by default (2026-10-11): a league game that ends tied stays tied unless the
    // judge switches overtime on for a cup/playoff game.
    overtimeEnabled: false,
    // Each overtime period's length — NOT a full half (was 25:00 per OT period).
    overtimePeriodMS: GameRules.defaultOvertimePeriodMS,   // 5:00
    halfBreakMinutes: 5,
    passivePlayEnabled: true,
  }
}

export const halfBreakMS = (settings) => settings.halfBreakMinutes * 60_000

// Play segments. Stable string keys (never localized) — the original matched on
// localized names, which silently broke the timeout cap.
export const Half = { first: 'first', second: 'second', third: 'third', ot1: 'ot1', ot2: 'ot2' }
export const halfIndex = { first: 0, second: 1, third: 2, ot1: 3, ot2: 4 }
export const isOvertime = (h) => h === Half.ot1 || h === Half.ot2

// High-level clock/match phase.
export const Phase = {
  ready: 'ready', readyOvertime: 'readyOvertime', running: 'running',
  paused: 'paused', breakTime: 'breakTime', editing: 'editing', over: 'over',
}

export const BreakKind = { halftime: 'halftime', homeTimeout: 'homeTimeout', guestTimeout: 'guestTimeout' }
export const CardType = { blue: 'blue', red: 'red' }
export const cardBaseSeconds = (type) => (type === CardType.red ? GameRules.redCardSeconds : GameRules.blueCardSeconds)
export const TeamSide = { home: 'home', guest: 'guest' }
