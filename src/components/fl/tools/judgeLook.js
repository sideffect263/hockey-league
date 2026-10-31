/**
 * Floodlight judge-board kit (web) — the colours, team visuals and words of the judge
 * board, ported from iOS `FLJudgeKit.swift` (branch floodlight). The board is ALWAYS
 * dark (it sits next to a rink and is mirrored to a TV), whatever the site theme.
 */
import { useEffect, useState } from 'react'
import { hsl, hexOf, bannerHexes, surfaceColors, isLight, edge, deep } from '@/lib/flTeam'
import { Half, GameFormat, GameRules } from '@/lib/game/rules'

export const JL = {
  page: '#070B10',
  panel: '#11171F',
  raised: '#1A2330',
  sheet: '#0F151E',
  line: '#263140',
  lineSoft: '#1E2733',
  sub: '#A9B2BF',
  muted: '#8B95A3',
  faint: '#6B7684',
  soft: '#C9D0D8',
  accent: '#F2B233',
  onAccent: '#0B0F14',
  foul: '#FF9F43',
  passive: '#7EE08F',
  passiveWarn: '#FF6B60',
  blue: '#2F6FD6',
  yellow: '#F5C518',
  red: '#E0362C',
  ledClock: '#00F2FF',
  errorBg: '#2A1517',
  errorFg: '#FF8A80',
  okBg: '#13301C',
  okFg: '#7EE08F',
}

/** A team's name colour on the near-black board: its banner colour lifted towards white. */
export function nameTint(team) {
  if (!team) return '#E6E6E6'
  const [p, s] = surfaceColors(team.primary_color, team.secondary_color)
  if (isLight(p)) return '#E6E6E6'
  const start = bannerHexes(p, s)?.start
  const c = start && hsl(start)
  if (!c) return '#E6E6E6'
  return hexOf({ h: c.h, s: Math.min(c.s, 0.75), l: Math.max(c.l, 0.68) })
}

/** The colour a side glows with (LED scores, the board's side glows). */
export function glowOf(team) {
  if (!team) return null
  const [p] = surfaceColors(team.primary_color, team.secondary_color)
  if (isLight(p)) return '#A3A3A3'
  return edge(team)
}

/** The picker's side panel: team colours for a goal, card colours for a card. */
export function panelFill(team, cardKind) {
  if (cardKind) {
    const [a, b] = cardKind === 'yellow' ? ['#6B5410', '#2A2208'] : cardKind === 'red' ? ['#8A1E18', '#3A0D0A'] : ['#1C47B8', '#0E2A6E']
    return `linear-gradient(135deg, ${a}, ${b})`
  }
  if (!team) return `linear-gradient(135deg, ${JL.raised}, ${JL.panel})`
  const [p] = surfaceColors(team.primary_color, team.secondary_color)
  if (isLight(p)) return 'linear-gradient(135deg, #C9C9C9, #8C8C8C)'
  return `linear-gradient(135deg, ${edge(team)}, ${deep(team)})`
}

export function periodName(half, format) {
  const thirds = format === GameFormat.threeThirds
  switch (half) {
    case Half.first: return thirds ? 'שליש 1' : 'מחצית 1'
    case Half.second: return thirds ? 'שליש 2' : 'מחצית 2'
    case Half.third: return 'שליש 3'
    case Half.ot1: return 'הארכה 1'
    case Half.ot2: return 'הארכה 2'
    default: return ''
  }
}

/** The line above the clock: the period, a timeout / break, the winner, or edit mode. */
export function boardTitle(engine, Phase) {
  if (engine.phase === Phase.editing) return 'עריכת זמן'
  if (engine.phase === Phase.breakTime || engine.phase === Phase.over) {
    // engine.periodLabel already says "פסק זמן — <team>" / "מנוחה" / "<team> ניצחה" / "תיקו"
    return engine.periodLabel === 'מנוחה' ? 'הפסקה' : engine.periodLabel
  }
  return periodName(engine.currentHalf, engine.settings.format)
}

export function nextPeriodNote(engine) {
  const thirds = engine.settings.format === GameFormat.threeThirds
  const next = { [Half.first]: Half.second, [Half.second]: thirds ? Half.third : Half.ot1, [Half.third]: Half.third, [Half.ot1]: Half.ot2, [Half.ot2]: Half.ot2 }[engine.currentHalf]
  return `${periodName(next, engine.settings.format)} מתחילה בסוף ההפסקה`
}

/** The game minute an event lands in ("דקה 38"), counted across periods. */
export function eventMinute(engine) {
  const s = engine.settings
  const timeMS = typeof engine._eventTimeMS === 'function' ? engine._eventTimeMS() : engine.clock.remainingMS
  const ot = s.overtimePeriodMS ?? GameRules.defaultOvertimePeriodMS
  const len = (engine.currentHalf === Half.ot1 || engine.currentHalf === Half.ot2) ? ot : s.periodMS
  const elapsed = Math.max(0, len - timeMS)
  const regs = s.format === GameFormat.threeThirds ? 3 : 2
  const before = { [Half.first]: 0, [Half.second]: s.periodMS, [Half.third]: s.periodMS * 2, [Half.ot1]: s.periodMS * regs, [Half.ot2]: s.periodMS * regs + ot }[engine.currentHalf] ?? 0
  return Math.floor((before + elapsed) / 60000) + 1
}

/** "#7 זקליק": shirt number and last name, for a card timer pill. */
export function cardWho(p) {
  if (!p) return 'כחול'
  const last = String(p.name || '').trim().split(/\s+/).pop() || p.name
  return p.number > 0 ? `#${p.number} ${last}` : last
}

/** A card timer: "1:20", "0:31" (no leading zero on the minutes). */
export function cardClock(seconds) {
  const s = Math.max(0, seconds | 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The board is drawn for 812×368 (an 844×390 phone minus margins), like iOS: `k` scales
 * type and widths, `v` the row heights, so a taller screen (laptop, TV) gets taller
 * rows instead of dead space.
 */
function measure() {
  if (typeof window === 'undefined') return { k: 1, v: 1, w: 828, portrait: false }
  const w = window.innerWidth - 16, h = window.innerHeight - 12
  const k = Math.max(0.6, Math.min(w / 812, h / 368))
  const v = Math.max(0.6, Math.min(h / 368, k * 1.35))
  return { k, v, w, portrait: window.innerHeight > window.innerWidth && window.innerWidth < 900 }
}

export function useBoardScale() {
  const [s, setS] = useState(measure)
  useEffect(() => {
    const on = () => setS(measure())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on) }
  }, [])
  return s
}

/* Yellow cards: the save RPC (judge_save_game_result) and the live broadcast have no
 * yellow field, so — exactly like iOS — they are recorded on the board only, kept per
 * game on this device next to the engine draft. */
const YKEY = (gameId) => `judge-yellow:v1:${gameId}`
export function loadYellows(gameId) {
  try { const v = JSON.parse(localStorage.getItem(YKEY(gameId)) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
export function saveYellows(gameId, list) {
  try { if (list.length) localStorage.setItem(YKEY(gameId), JSON.stringify(list)); else localStorage.removeItem(YKEY(gameId)) } catch { /* ignore */ }
}
