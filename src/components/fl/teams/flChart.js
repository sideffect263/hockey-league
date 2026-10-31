/**
 * Floodlight chart colours (teams area). Chrome (grid / axis / muted / ink) on the
 * Floodlight card surfaces, and team series colours that use the TEAM'S OWN TINT
 * wherever it stays readable — falling back to the validated categorical slot
 * (lib/chartPalette) when it does not.
 *
 * A team tint is used only when BOTH hold:
 *  - ≥ 3:1 contrast against the card in the current theme (#FAF9F6 light, #151B23 dark);
 *  - it is clearly apart from every tint already handed out (two greens / two blues in
 *    the league would otherwise read as one series) — else the palette slot.
 * Team identity is still carried by the crest + name in the legend and end labels.
 */
import { seriesColors, teamColorIndex } from '@/lib/chartPalette'
import { teamTint, hsl, luminance } from '@/lib/flTeam'

export const FL_CHROME = {
  light: { grid: '#E4E0D8', axis: '#D3CFC6', muted: '#5B616B', ink: '#11161D', surface: '#FAF9F6' },
  dark: { grid: '#2A323D', axis: '#3A434F', muted: '#9AA3AE', ink: '#ECEAE4', surface: '#151B23' },
}
export const flChrome = (dark) => (dark ? FL_CHROME.dark : FL_CHROME.light)

/** Floodlight "ink / amber" pair for two-series charts (e.g. זכות / חובה). */
export const flPair = (dark) => (dark
  ? { pos: '#F2B233', neg: '#ECEAE4' }
  : { pos: '#C98A12', neg: '#11161D' })

const SURF_LUM = { light: 0.946, dark: 0.0105 }

export function contrastOn(hex, dark) {
  const c = hsl(hex)
  if (!c) return 0
  const L = luminance(c), S = dark ? SURF_LUM.dark : SURF_LUM.light
  return (Math.max(L, S) + 0.05) / (Math.min(L, S) + 0.05)
}

function apart(a, b) {
  const x = hsl(a), y = hsl(b)
  if (!x || !y) return true
  const dh = Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h))
  return dh >= 40 || Math.abs(x.l - y.l) >= 0.2
}

/** team id → series colour. Stable (keyed on sorted id), never rank-dependent. */
export function teamSeriesColors(teams = [], dark = false) {
  const idx = teamColorIndex(teams)
  const pal = seriesColors(dark)
  const used = []
  const out = {}
  for (const t of [...teams].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const tint = teamTint(t)
    if (contrastOn(tint, dark) >= 3 && used.every((u) => apart(u, tint))) {
      out[t.id] = tint
      used.push(tint)
    }
  }
  for (const t of teams) {
    if (out[t.id]) continue
    // Fallback: the validated slot, or the first slot that is apart from what is used.
    let c = pal[idx[t.id]] || pal[0]
    if (!used.every((u) => apart(u, c))) c = pal.find((p) => used.every((u) => apart(u, p))) || c
    out[t.id] = c
    used.push(c)
  }
  return out
}
