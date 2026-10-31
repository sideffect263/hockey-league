/**
 * Floodlight shared pieces (web), the same set iOS has in FloodlightComponents.swift and
 * Android in FloodlightComponents.kt. The build spec is the System board on the canvas
 * (https://claude.ai/artifact/4teXtBPW6Vxuj8Qmr263qV; copy in MOBILE-BUILD/floodlight/boards-web).
 *
 * Rules these encode, so pages don't have to remember them:
 * - home is on the RIGHT, everywhere (blend, score, crests);
 * - a score is separate spans, never one "4:2" string;
 * - a crest on a dark/colour background sits in the light disc (#FAF9F6), except the
 *   game/team heroes, which pass disc={false};
 * - numbers are Rubik 800 italic tabular (.fl-num);
 * - the rink drawing is a real 40×20 rink.
 *
 * Area-specific helpers do NOT go here: put them in src/components/fl/<area>/.
 */
import { Link } from 'react-router-dom'
import TeamLogo from '@/components/TeamLogo'
import { teamBlend, BLEND_VIGNETTE } from '@/lib/flTeam'

/** A crest in its light disc. `size` in px. disc={false}: the crest alone (heroes). */
export function CrestDisc({ team, size = 44, disc = true, shadow = false, className = '' }) {
  return <TeamLogo team={team} px={size} disc={disc} shadow={shadow} className={className} />
}

/**
 * The two-team gradient (away LEFT, home RIGHT, dark middle) as a block background.
 * Children sit above the vignette. `as` lets a game card be a <Link>.
 */
export function TeamBlend({ home, away, vignette = true, angle = 90, className = '', style, children, as: As = 'div', ...rest }) {
  return (
    <As className={`relative isolate overflow-hidden text-white ${className}`} style={{ backgroundImage: teamBlend(home, away, { angle }), ...style }} {...rest}>
      {vignette && <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: BLEND_VIGNETTE }} />}
      {children}
    </As>
  )
}

/**
 * A score: home on the RIGHT. Separate spans in a forced-RTL row, so the home number
 * is the first child (rightmost) and the reading order is home, away.
 * `homeWon`/`awayWon` dim the loser when the game is over.
 */
export function FLScore({ home, away, size = 40, sep = ':', dimLoser = false, className = '' }) {
  const h = home ?? '–', a = away ?? '–'
  const over = dimLoser && home != null && away != null && home !== away
  const hDim = over && home < away, aDim = over && away < home
  return (
    <span dir="rtl" className={`inline-flex items-baseline gap-[0.18em] fl-num leading-none ${className}`} style={{ fontSize: size }}
      aria-label={`${h} : ${a}`}>
      <span className={hDim ? 'opacity-50' : ''}>{h}</span>
      <span aria-hidden="true" className="opacity-60 text-[0.7em] -translate-y-[0.06em]">{sep}</span>
      <span className={aDim ? 'opacity-50' : ''}>{a}</span>
    </span>
  )
}

/** Small pill. tone: 'glass' (on a blend), 'live', 'accent', 'ink', 'quiet'. */
export function FLChip({ tone = 'quiet', children, className = '', ...rest }) {
  const tones = {
    glass: 'bg-white/15 text-white backdrop-blur-sm',
    live: 'bg-fl-live text-white',
    accent: 'bg-fl-accent text-[#11161D]',
    ink: 'bg-fg-strong text-surface',
    quiet: 'bg-surface-sunken text-fg-muted',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-bold whitespace-nowrap ${tones[tone] || tones.quiet} ${className}`} {...rest}>
      {children}
    </span>
  )
}

/** The LIVE chip with its dot. The dot pulses twice, then rests (nothing loops forever). */
export function LiveChip({ label = 'LIVE', className = '' }) {
  return (
    <FLChip tone="live" className={className}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-white fl-pulse-2" />
      {label}
    </FLChip>
  )
}

/**
 * A real 40×20 rink-hockey floor, drawn at 9 units per metre (360×180): boards with the
 * orange cap, centre line + 3 m circle, goal lines 2.6 m from the ends, the 9×5.4 m
 * areas, spots and goals. Decorative (aria-hidden). `strength` 0..1 = line opacity.
 */
export function RinkDrawing({ strength = 0.5, className = '', style }) {
  const s = strength
  return (
    <svg viewBox="0 0 360 180" fill="none" aria-hidden="true" className={className} style={style} preserveAspectRatio="xMidYMid meet">
      <rect x="2" y="2" width="356" height="176" rx="9" stroke="rgb(var(--fl-rink-boards))" strokeOpacity={0.4 + s * 0.2} strokeWidth="4" />
      <rect x="2" y="2" width="356" height="176" rx="9" stroke="rgb(var(--fl-rink-cap))" strokeOpacity={0.35 * s / 0.5} strokeWidth="1" />
      <g stroke="rgb(var(--fl-rink-lines))" strokeOpacity={Math.min(1, s * 1.1)} strokeWidth="1.6">
        <line x1="180" y1="4" x2="180" y2="176" />
        <circle cx="180" cy="90" r="27" />
        <line x1="23.4" y1="4" x2="23.4" y2="176" />
        <line x1="336.6" y1="4" x2="336.6" y2="176" />
        <rect x="23.4" y="49.5" width="48.6" height="81" />
        <rect x="288" y="49.5" width="48.6" height="81" />
      </g>
      <g fill="rgb(var(--fl-rink-lines))" fillOpacity={Math.min(1, s * 1.4)}>
        <circle cx="180" cy="90" r="2.5" /><circle cx="72" cy="90" r="2" /><circle cx="288" cy="90" r="2" />
      </g>
      <g stroke="#fff" strokeOpacity={Math.min(1, s * 1.2)} strokeWidth="1.6">
        <rect x="15.4" y="82.4" width="8" height="15.3" /><rect x="336.6" y="82.4" width="8" height="15.3" />
      </g>
    </svg>
  )
}

/** Team name that links to its team page (game page rule: crest/name → team page). */
export function TeamLink({ team, className = '', children }) {
  if (!team?.id) return <span className={className}>{children ?? team?.name}</span>
  return <Link to={`/teams/${team.slug || team.id}`} className={`hover:underline underline-offset-4 ${className}`}>{children ?? team.name}</Link>
}

/**
 * The GamePost / game-card hero band: blend, optional real photo behind it (game
 * still or clip frame — never a stock image), crests (home RIGHT), score or time.
 * Pages pass the pieces they have; nothing here fetches.
 */
export function GameBand({ home, away, homeScore, awayScore, photoUrl, top, middle, bottom, crestSize = 56, disc = true, className = '' }) {
  const showScore = homeScore != null && awayScore != null
  return (
    <TeamBlend home={home} away={away} className={`rounded-card ${className}`}>
      {photoUrl && (
        <>
          <img src={photoUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 -z-20 size-full object-cover" />
          <span aria-hidden="true" className="absolute inset-0 -z-10 opacity-80" style={{ backgroundImage: teamBlend(home, away) }} />
        </>
      )}
      <RinkDrawing strength={0.35} className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full -z-10 opacity-70" />
      <div className="relative p-4 flex flex-col gap-3">
        {top && <div className="flex items-center justify-between gap-2 text-[13px]">{top}</div>}
        <div dir="rtl" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <Side team={home} size={crestSize} disc={disc} />
          <div className="flex flex-col items-center gap-1 min-w-[5rem]">
            {middle ?? (showScore ? <FLScore home={homeScore} away={awayScore} size={44} /> : null)}
          </div>
          <Side team={away} size={crestSize} disc={disc} />
        </div>
        {bottom && <div className="text-[13px]">{bottom}</div>}
      </div>
    </TeamBlend>
  )
}

function Side({ team, size, disc }) {
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0 text-center">
      <CrestDisc team={team} size={size} disc={disc} />
      <span className="text-[14px] font-extrabold leading-tight line-clamp-2 text-white">{team?.name}</span>
    </div>
  )
}

/** A Floodlight section header: title (+ optional count) and an optional action link. */
export function FLSectionHead({ title, count, action, className = '' }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      <h2 className="text-[22px] font-extrabold leading-tight text-fg-strong">
        {title}{count != null && <span className="fl-num text-[20px] text-fg-muted ms-2">{count}</span>}
      </h2>
      {action}
    </div>
  )
}
