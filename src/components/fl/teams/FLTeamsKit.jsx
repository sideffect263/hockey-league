/**
 * Floodlight teams / players / standings kit (web) — the same pieces iOS has in
 * FLTeamsKit.swift + StandingsView.swift + StickPlusGlyph.swift (KeeperStickMark).
 * Boards: Standings, Scorers, TeamsList, Team, TeamLight, TeamSquad, PlayersList,
 * Player, PlayerKeeper (MOBILE-BUILD/floodlight/boards-web). Teams area only: every
 * export is prefixed FLT* / Keeper* so it never clashes with another area's kit.
 */
import { useEffect, useId, useState } from 'react'
import TeamLogo from '@/components/TeamLogo'
import { sizedImage } from '@/lib/imageSize'
import { teamBanner, teamIsLight, teamTint, deep, hsl, hexOf } from '@/lib/flTeam'
import { RinkDrawing } from '@/components/fl/Floodlight'

export const INK_ON_LIGHT = '#11161D'

/* ---------------------------------------------------------------- hero palette */

/**
 * The colours of a team-coloured hero (iOS FLHeroPalette). A light team (קריית מוצקין
 * #FFFFFF / #A3A3A3) keeps its real white → grey and flips every text on it to ink.
 */
export function heroPalette(team) {
  if (!team) {
    return { c1: '#2A3442', mid: '#1A212B', c2: '#0B0F14', light: false, ink: '#FFFFFF', tint: '#5B616B' }
  }
  if (teamIsLight(team)) {
    const c1 = validHex(team.primary_color) || '#FFFFFF'
    const c2 = validHex(team.secondary_color) || '#A3A3A3'
    return { c1, mid: '#EDEDED', c2, light: true, ink: INK_ON_LIGHT, tint: '#8A8F98' }
  }
  const [start, end] = teamBanner(team)
  return { c1: start, mid: mix(start, end, 0.35), c2: deep(team), light: false, ink: '#FFFFFF', tint: teamTint(team) }
}

function validHex(h) {
  const m = String(h || '').trim()
  return /^#?[0-9a-f]{6}$/i.test(m) ? (m.startsWith('#') ? m : `#${m}`) : null
}

function mix(a, b, t) {
  const pa = hsl(a), pb = hsl(String(b).slice(0, 7))
  if (!pa || !pb) return a
  return hexOf({ h: pa.h + (pb.h - pa.h) * t, s: pa.s + (pb.s - pa.s) * t, l: pa.l + (pb.l - pa.l) * t })
}

/** The hero gradient (CSS, pinned to physical directions so RTL never mirrors it). */
export function heroGradient(p, angle = 160) {
  return `linear-gradient(${angle}deg, ${p.c1} 0%, ${p.mid} ${p.light ? 45 : 38}%, ${p.c2} 100%)`
}

/** Hero sub-surfaces (stat box, round buttons, soft chips, rules). */
export function heroSurfaces(p) {
  return p.light
    ? { panel: 'rgba(255,255,255,.75)', panelBorder: 'rgba(17,22,29,.08)', chip: 'rgba(17,22,29,.07)', soft: 'rgba(17,22,29,.06)', rule: 'rgba(17,22,29,.12)', sub: 'rgba(17,22,29,.72)' }
    : { panel: 'rgba(8,12,18,.45)', panelBorder: 'transparent', chip: 'rgba(8,12,18,.35)', soft: 'rgba(255,255,255,.12)', rule: 'rgba(255,255,255,.14)', sub: 'rgba(255,255,255,.78)' }
}

/**
 * A team-coloured hero block: gradient, faint rink drawing, rounded bottom. Children
 * carry their own padding. `className` adds outer spacing.
 */
export function FLTHero({ palette, rink = true, className = '', children, style }) {
  return (
    <section className={`relative isolate overflow-hidden rounded-b-[30px] sm:rounded-[28px] ${className}`}
      style={{ backgroundImage: heroGradient(palette), color: palette.ink, ...style }}>
      {rink && (
        <RinkDrawing strength={palette.light ? 0.3 : 0.16}
          className="pointer-events-none absolute inset-x-0 top-24 -z-10 w-full max-h-[70%]"
          style={{ opacity: palette.light ? 0.45 : 0.4 }} />
      )}
      {palette.light && <span aria-hidden="true" className="absolute inset-x-8 bottom-0 h-px" style={{ background: 'rgba(17,22,29,.08)' }} />}
      {children}
    </section>
  )
}

/** A row of big italic numbers with hairlines between them (hero stat box content). */
export function FLTStatsRow({ items, palette, size = 30, onCard = false }) {
  const s = palette ? heroSurfaces(palette) : null
  return (
    <div className="flex items-stretch">
      {items.map((it, i) => (
        <div key={it.label} className="flex flex-1 min-w-0 items-stretch">
          {i > 0 && <span aria-hidden="true" className={`w-px self-center ${onCard ? 'bg-line' : ''}`} style={{ height: size + 18, background: onCard ? undefined : s?.rule }} />}
          <div className="flex flex-1 min-w-0 flex-col items-center gap-1.5">
            <span dir="ltr" className={`fl-num leading-none ${onCard ? 'text-fg-strong' : ''}`}
              style={{ fontSize: size, color: onCard ? undefined : (it.highlight && !palette?.light ? 'rgb(var(--fl-accent))' : palette?.ink) }}>
              {it.value}
            </span>
            <span className={`text-[11px] leading-tight text-center truncate max-w-full ${onCard ? 'text-fg-muted' : ''}`}
              style={{ color: onCard ? undefined : s?.sub }}>{it.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- tabs / chips */

/** The 2–4 option segmented switch (raised track, card-coloured thumb). */
export function FLTSegmented({ options, value, onChange, label, className = '' }) {
  return (
    <div role="tablist" aria-label={label} className={`flex rounded-control bg-surface-sunken p-[3px] ${className}`}>
      {options.map(([v, text]) => {
        const on = v === value
        return (
          <button key={v} type="button" role="tab" aria-selected={on} onClick={() => onChange(v)}
            className={`flex-1 min-h-[44px] rounded-[11px] px-3 text-[14px] transition-colors ${on ? 'bg-surface text-fg-strong font-bold shadow-sm' : 'text-fg-muted font-medium hover:text-fg-strong'}`}>
            {text}
          </button>
        )
      })}
    </div>
  )
}

/** Pill chips (ink when selected). `items` = [{ value, label, count? }]. */
export function FLTPills({ items, value, onChange, label, className = '' }) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1.5 overflow-x-auto nav-scroll -mx-1 px-1 ${className}`}>
      {items.map((it) => {
        const on = it.value === value
        return (
          <button key={it.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(it.value)}
            className={`shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full text-[14px] font-bold transition-colors ${on ? 'bg-fg-strong text-surface' : 'bg-surface text-fg-strong hover:bg-surface-sunken'}`}>
            {it.label}
            {it.count != null && <span className="fl-num text-[12px] opacity-70">{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Small rounded tag. */
export function FLTTag({ children, className = '', style }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-extrabold leading-tight bg-surface-sunken text-fg-strong ${className}`} style={style}>
      {children}
    </span>
  )
}

/** "OG #N" (ink tag, amber text). Nothing when there is no number. */
export function FLTOgTag({ number, className = '' }) {
  if (!number) return null
  return (
    <span dir="ltr" aria-label={`OG מספר ${number}`}
      className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-extrabold leading-tight bg-[#11161D] text-fl-accent dark:ring-1 dark:ring-white/15 ${className}`}>
      OG #{number}
    </span>
  )
}

/* ---------------------------------------------------------------- washes */

/** A row background: the team colour fading in from the RIGHT (leading) edge over the card. */
export function rowWash(color, alpha = 0.16, stop = 45) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return { backgroundImage: `linear-gradient(270deg, ${color}${a} 0%, ${color}00 ${stop}%)` }
}

/* ---------------------------------------------------------------- keeper stick */

/**
 * The goalkeeper mark next to a keeper's name in squads, line-ups and lists: one keeper
 * stick, leaning 28°, in ink (currentColor — reads in light and dark) with the lime
 * print (iOS KeeperStickMark). Labelled "שוער".
 */
export function KeeperStickMark({ size = 22, className = '', title = 'שוער' }) {
  const id = useId().replace(/:/g, '')
  const stick = 'M9.6 2.2L9.6 20.5L7 22.5L7 56.5C7 58.5 7.2 60 8 61.4C9 63 11.5 64.2 15 64.3L19.6 64.3Q20.8 64.3 20.8 63.2L20.8 60.6Q20.8 59.8 20 59.8C18.6 59.8 17.2 59.5 16 58.9C14.4 58.1 13 56.8 13 55L13 2.2Z'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} className={`shrink-0 text-fg-strong ${className}`}>
      <title>{title}</title>
      <defs><clipPath id={`ks${id}`}><path d={stick} /></clipPath></defs>
      <g transform="translate(32 32) rotate(28) scale(0.98) translate(-14 -33)">
        <path d={stick} fill="currentColor" stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" />
        <g clipPath={`url(#ks${id})`}>
          <rect x="7" y="44" width="6" height="7" fill="#D4EE3A" />
          <path d="M7 46.5L13 45M7 49.5L13 48" stroke="currentColor" strokeWidth="0.8" />
          <circle cx="14.5" cy="62.35" r="0.55" fill="#ECEAE4" />
          <circle cx="17.2" cy="62.35" r="0.55" fill="#ECEAE4" />
        </g>
        <rect x="9.1" y="0" width="4.4" height="3" rx="0.9" fill="#ECEAE4" />
      </g>
    </svg>
  )
}

export const isKeeper = (p) => p?.position === 'Goalkeeper'

/* ---------------------------------------------------------------- goal cage */

/** A goal cage seen from the front (keeper hero): net, red posts and bar, the goal line. */
export function FLTGoalCage({ className = '', style }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 340 210" aria-hidden="true" className={className} style={style} preserveAspectRatio="xMidYMax meet">
      <defs>
        <pattern id={`net${id}`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0L0 14M0 0L14 0" stroke="rgba(255,255,255,.09)" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect x="20" y="16" width="300" height="186" fill={`url(#net${id})`} />
      <path d="M20 202L20 16L320 16L320 202" fill="none" stroke="rgb(var(--fl-live))" strokeOpacity=".75" strokeWidth="7" strokeLinejoin="round" />
      <line x1="6" y1="202" x2="334" y2="202" stroke="rgb(var(--fl-rink-lines))" strokeOpacity=".45" strokeWidth="2" />
    </svg>
  )
}

/* ---------------------------------------------------------------- player face */

/**
 * A player's face; with no photo his team crest stands in (Ariel: the crest is the photo
 * fallback). `ring` draws a team-colour ring around it.
 */
export function FLTPlayerFace({ player, team, size = 44, ring, ringWidth = 2, className = '' }) {
  const photo = player?.owner_avatar_url || player?.photo_url || null
  const [err, setErr] = useState(false)
  useEffect(() => { setErr(false) }, [photo])
  const inner = (
    photo && !err ? (
      <img src={sizedImage(photo, Math.round(size * 1.3))} alt="" loading="lazy" decoding="async" onError={() => setErr(true)}
        className="size-full rounded-full object-cover bg-surface-sunken" />
    ) : team ? (
      <span className="relative flex size-full items-center justify-center rounded-full bg-fl-disc overflow-hidden">
        <span aria-hidden="true" className="absolute inset-0" style={{ background: `${teamTint(team)}21` }} />
        <TeamLogo team={team} px={Math.round(size * 0.72)} disc={false} className="relative" />
      </span>
    ) : (
      <span className="flex size-full items-center justify-center rounded-full bg-surface-sunken text-fg-muted font-extrabold" style={{ fontSize: size * 0.4 }}>
        {(player?.first_name || '?').trim().charAt(0)}
      </span>
    )
  )
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 rounded-full ${className}`}
      style={{ width: size + (ring ? ringWidth * 2 : 0), height: size + (ring ? ringWidth * 2 : 0), padding: ring ? ringWidth : 0, background: ring || 'transparent' }}>
      {inner}
    </span>
  )
}

/* ---------------------------------------------------------------- misc */

/** "+5" / "−3" / "0" (true minus sign), for goal differences. */
export const fmtDiff = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')

/** A Floodlight page title row: big title, optional sub line, optional action. */
export function FLTPageHead({ title, sub, action, className = '' }) {
  return (
    <header className={`flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-[34px] sm:text-[44px] font-extrabold leading-[1.05] text-fg-strong">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-fg-muted">{sub}</p>}
      </div>
      {action}
    </header>
  )
}

/** A result square (נ / ת / ה). */
export function FLTResultSquare({ mine, theirs, size = 20 }) {
  const r = mine > theirs ? 'w' : mine < theirs ? 'l' : 't'
  const label = r === 'w' ? 'נ' : r === 't' ? 'ת' : 'ה'
  const cls = r === 'w' ? 'bg-fl-accent text-[#11161D]' : r === 'l' ? 'bg-[#6B7079] text-white' : 'bg-[#8F897E] text-white'
  return (
    <span aria-label={r === 'w' ? 'ניצחון' : r === 't' ? 'תיקו' : 'הפסד'}
      className={`inline-flex items-center justify-center rounded-md text-[11px] font-extrabold ${cls}`} style={{ width: size, height: size }}>
      {label}
    </span>
  )
}
