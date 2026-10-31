/**
 * Floodlight team colours — an exact port of iOS `TeamColors` + `FLTeam`
 * (HockeyTimer-iOS floodlight: Sources/Shared/Design/TeamColors.swift,
 * Sources/iOS/Hub/FloodlightComponents.swift) and Android `TeamColors.kt`, so a team
 * is the same colour on the site, the iPhone and the Android app.
 *
 * The stored `teams.primary_color` / `secondary_color` are whatever the coach picked
 * (white, neon green, cyan…), so they are never drawn raw behind white text:
 * - a chromatic colour keeps its hue; saturation is capped and lightness lowered until
 *   white text reaches ≥ 4:1;
 * - a light achromatic colour (white/grey) becomes a slate tone, a dark one a near-black
 *   tinted with the team's other hue;
 * - a missing colour falls back to a hashed palette colour.
 *
 * A LIGHT team (קריית מוצקין #FFFFFF / #A3A3A3) keeps its real white/grey on its own
 * surfaces and flips the text on it to ink (`onColor`). White + a real colour
 * (גבעת עדה איחוד #FFFFFF + #0C26E9) is NOT light: it is drawn as its colour.
 */

const MAX_LUMINANCE = 0.2125 // white text at ≥ 4:1

export function hsl(hex) {
  const m = String(hex || '').trim().replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(m)) return null
  const v = parseInt(m, 16)
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  const l = (mx + mn) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6)
    else if (mx === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s, l }
}

function rgbOf({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m]
}

export function chromatic(c) {
  const [r, g, b] = rgbOf(c)
  return c.s >= 0.12 && Math.max(r, g, b) - Math.min(r, g, b) >= 0.08
}

export function luminance(c) {
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const [r, g, b] = rgbOf(c)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function hexOf(c) {
  const to = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  const [r, g, b] = rgbOf(c)
  return `#${to(r)}${to(g)}${to(b)}`
}

const nearBlack = (hue) => ({ h: hue ?? 218, s: hue == null ? 0.18 : 0.35, l: 0.11 })

function slate(c) {
  const out = { h: 218, s: 0.16, l: 0.30 + 0.12 * (c.l - 0.5) / 0.5 }
  while (luminance(out) > MAX_LUMINANCE && out.l > 0.12) out.l -= 0.01
  return out
}

function conditioned(c, partnerHue) {
  if (!chromatic(c)) return c.l < 0.3 ? nearBlack(partnerHue) : slate(c)
  const out = { h: c.h, s: Math.min(c.s, 0.88), l: Math.min(c.l, 0.55) }
  while (luminance(out) > MAX_LUMINANCE && out.l > 0.12) out.l -= 0.01
  out.l = Math.max(out.l, 0.18)
  return out
}

const deeper = (c) => ({ h: c.h, s: Math.min(1, c.s * 1.05), l: Math.max(0.1, c.l * 0.62) })

/** Banner gradient stops { start, end } ("#rrggbb"), or null when neither colour is usable. */
export function bannerHexes(primary, secondary) {
  const p = hsl(primary), s = hsl(secondary)
  if (p) {
    const start = conditioned(p, s && chromatic(s) ? s.h : null)
    let end
    if (s && chromatic(s)) end = conditioned(s, p.h)
    else if (s && !chromatic(s) && s.l < 0.3) end = nearBlack(chromatic(p) ? p.h : null)
    else end = deeper(start)
    return { start: hexOf(start), end: hexOf(end) }
  }
  if (s) {
    const start = conditioned(s, null)
    return { start: hexOf(start), end: hexOf(deeper(start)) }
  }
  return null
}

// Same order and values as iOS Brand.teamPalette.
const PALETTE = ['#3382f0', '#f04d4d', '#2eb370', '#8c59db', '#f59e1a', '#17a3b8', '#e65999', '#5c6b8c']

/** djb2 over code points, like iOS Brand.teamColor(seed). */
export function seedColor(seed) {
  let hash = 5381
  for (const ch of String(seed || '')) hash = (Math.imul(hash, 33) + ch.codePointAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

/** The team tint ("#rrggbb"): the banner start, else the seed colour. */
export function teamTint(team) {
  const [p, s] = surfaceColors(team?.primary_color, team?.secondary_color)
  return bannerHexes(p, s)?.start || seedColor(team?.id || team?.name)
}

/** Two banner colours for one team (team page hero, player banner). */
export function teamBanner(team) {
  const [p, s] = surfaceColors(team?.primary_color, team?.secondary_color)
  const b = bannerHexes(p, s)
  if (b) return [b.start, b.end]
  const t = seedColor(team?.id || team?.name)
  return [t, t + 'b3']
}

export function isLight(primary) {
  const p = hsl(primary)
  return !!p && !chromatic(p) && p.l >= 0.6
}

/** White + a real colour is that colour's team; white + grey stays light. */
export function surfaceColors(primary, secondary) {
  if (!isLight(primary)) return [primary, secondary]
  const s = hsl(secondary)
  return s && chromatic(s) ? [secondary, primary] : [primary, secondary]
}

/** Light team on its own surface: is the text on it ink (true) or white? */
export function teamIsLight(team) {
  const [p] = surfaceColors(team?.primary_color, team?.secondary_color)
  return isLight(p)
}

/** Text colour on a team's own colour: white, or ink for a light team. */
export function onColor(team) {
  return teamIsLight(team) ? '#11161D' : '#FFFFFF'
}

/** The outer colour of a team's half of a blend. */
export function edge(team) {
  const [p, s] = surfaceColors(team?.primary_color, team?.secondary_color)
  if (isLight(p)) return p
  return bannerHexes(p, s)?.start || seedColor(team?.id || team?.name)
}

/** A near-black tinted with the team's hue: the dark middle of a two-team blend. */
export function deep(team) {
  const [p, s] = surfaceColors(team?.primary_color, team?.secondary_color)
  if (isLight(p)) return '#2A2F37'
  const h = bannerHexes(p, s)?.start
  const c = h && hsl(h)
  return c ? hexOf({ h: c.h, s: Math.min(c.s, 0.55), l: 0.14 }) : '#141A24'
}

/**
 * The team-colour gradient that runs through every game surface: away at the
 * physical LEFT, home at the physical RIGHT, a dark middle so the score reads.
 * It is a `to right` gradient, so an RTL page never mirrors it. A light team's edge
 * is a dimmed grey (#8C8C8C), not white (canonical-game decision 10-28).
 */
export function teamBlend(home, away, { angle = 90 } = {}) {
  const half = (t) => [teamIsLight(t) ? '#8C8C8C' : edge(t), deep(t)]
  const [aEdge, aDeep] = half(away)
  const [hEdge, hDeep] = half(home)
  return `linear-gradient(${angle}deg, ${aEdge} 0%, ${aDeep} 34%, ${hDeep} 66%, ${hEdge} 100%)`
}

/** The vignette laid over a blend so the middle (the score) always reads. */
export const BLEND_VIGNETTE = 'radial-gradient(60% 90% at 50% 50%, rgba(8,12,18,.42), rgba(8,12,18,0))'
