import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from "lucide-react"
import { Squad as Users } from "@/components/icons/BrandIcons"
import TeamLogo from '@/components/TeamLogo'
import { TeamBlend, CrestDisc } from '@/components/fl/Floodlight'
import { useTheme } from '@/lib/ThemeContext'
import { seriesTeamColors } from '@/lib/teamMarkColor'
import { pct, gameSides, CONFLICT_COPY, coins as fmtCoins } from '@/lib/market'
import { StatusChip } from './MarketCard'

const TZ = 'Asia/Jerusalem'
const kickoff = iso => iso
  ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  : ''

/**
 * Home and away colours for a fixture's split bar.
 *
 * Same conditioning as the price chart (lib/teamMarkColor): the club's hue,
 * pulled into a band that is visible on the card. Two marks, each labelled with
 * its crest and name right above it — the case the price-chart amendment allows.
 * The draw is always neutral ink, never a third "team".
 */
export function useSideColors(home, away) {
  const { dark } = useTheme()
  return useMemo(() => {
    const [h, a] = seriesTeamColors([
      { color: home?.team?.primary_color, teamId: home?.team?.id || 'home' },
      { color: away?.team?.primary_color, teamId: away?.team?.id || 'away' },
    ], dark)
    return { home: h, away: a }
  }, [home, away, dark])
}

/**
 * One probability bar split three ways — home · draw · away — so a fixture reads
 * at a glance as "who is favoured, by how much", instead of three equal grey rows.
 * Home sits on the right, where it sits everywhere else on this RTL site.
 */
export function SplitBar({ home, draw, away, colors, tall = false }) {
  const parts = [
    { o: home, c: colors.home },
    { o: draw, c: 'rgb(var(--fg-faint))' },
    { o: away, c: colors.away },
  ].filter(p => p.o)
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-surface-sunken gap-0.5 ${tall ? 'h-3' : 'h-2'}`}>
      {parts.map(p => (
        <div key={p.o.id} className="h-full transition-[width] duration-700 ease-out first:rounded-s-full last:rounded-e-full"
          style={{ width: `${Math.max(p.o.price * 100, 2)}%`, backgroundColor: p.c }} />
      ))}
    </div>
  )
}

/** One outcome tile under the blend: the fill IS the probability, from the right. */
function OutcomeTile({ outcome, label, color, mine }) {
  if (!outcome) return <span />
  const p = Math.round(outcome.price * 100)
  return (
    <span className={`relative h-[54px] rounded-xl bg-surface-page overflow-hidden flex flex-col items-center justify-center gap-0.5 border-2 ${
      mine ? 'border-pos' : 'border-transparent'}`}>
      <span aria-hidden="true" className="absolute inset-y-0 right-0 transition-[width] duration-300 ease-out"
        style={{ width: `${Math.max(p, 2)}%`, backgroundColor: color, opacity: 0.18 }} />
      <span className="relative fl-num text-[19px] text-fg-strong">{p}%</span>
      <span className="relative text-[12px] font-semibold text-fg-strong max-w-full px-1 truncate">{label}</span>
    </span>
  )
}

/**
 * A fixture on the board (PredictHome board): the two-team blend with both crests
 * (home RIGHT) and the kick-off, then the three-way percentages as tiles. The tile
 * the viewer predicted on gets a green ring and a "התחזית שלך" line.
 */
export default function MatchCard({ market, positions = {}, conflict = null, activity = null }) {
  const { home, draw, away } = gameSides(market)
  const colors = useSideColors(home, away)
  const mineOf = o => o && Number(positions[o.id]?.shares) > 0
  const heldAny = market.outcomes.some(mineOf)
  const myPick = market.outcomes.find(mineOf)
  const href = `/market/${encodeURIComponent(market.slug || market.id)}`
  const pickLine = myPick && (() => {
    const p = positions[myPick.id]
    return `${myPick.label} · ${fmtCoins(Math.round(Number(p.cost_basis) || 0))} סטופרים · אם צודקים, גדלים ל־${fmtCoins(Math.round(Number(p.shares)))}`
  })()

  const body = (
    <>
      <TeamBlend home={home?.team} away={away?.team} className="h-16 px-3.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0 flex-1">
          <CrestDisc team={home?.team} size={40} />
          <span className="text-sm font-bold truncate">{home?.label}</span>
        </span>
        <span className="fl-num text-[18px] shrink-0" dir="ltr">{kickoff(market.game?.game_date)}</span>
        <span className="flex items-center gap-2 min-w-0 flex-1 justify-end">
          <span className="text-sm font-bold truncate">{away?.label}</span>
          <CrestDisc team={away?.team} size={40} />
        </span>
      </TeamBlend>

      <div className="grid grid-cols-3 gap-1.5 p-2.5">
        <OutcomeTile outcome={home} label={home?.label} color={colors.home} mine={mineOf(home)} />
        <OutcomeTile outcome={draw} label="תיקו" color="rgb(var(--fg-faint))" mine={mineOf(draw)} />
        <OutcomeTile outcome={away} label={away?.label} color={colors.away} mine={mineOf(away)} />
      </div>

      {pickLine && (
        <p className="px-3.5 -mt-0.5 pb-2 text-[12.5px] font-bold text-pos">התחזית שלך: {pickLine}</p>
      )}

      <div className="px-3.5 pb-3 flex items-center gap-2 text-[12px] text-fg-muted min-w-0">
        {conflict ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{CONFLICT_COPY[conflict] || CONFLICT_COPY['own-team']}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 min-w-0">
            <Users className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {activity?.traders
                ? (activity.traders === 1 ? 'משתתף אחד' : <><span className="fl-num">{activity.traders}</span> משתתפים</>)
                : 'עוד אין תחזיות'}
              {market.game?.venue ? ` · ${market.game.venue}` : ''}
            </span>
          </span>
        )}
        <span className="ms-auto shrink-0"><StatusChip market={market} /></span>
      </div>
    </>
  )

  if (conflict) {
    return <div className="mkt-card block overflow-hidden">{body}</div>
  }
  return (
    <Link to={href} aria-label={`${home?.label || ''} נגד ${away?.label || ''}${heldAny ? ' · יש לך תחזית' : ''}`}
      className="mkt-card-hover block overflow-hidden transition-transform hover:-translate-y-0.5">
      {body}
    </Link>
  )
}

/**
 * A fixture folded to one line — crests, names and the three prices. Later
 * matchdays render as these so a season's worth of games fits in a few screens
 * instead of forty tall cards.
 */
export function GameRow({ market, positions = {}, conflict = null }) {
  const { home, draw, away } = gameSides(market)
  const colors = useSideColors(home, away)
  const held = market.outcomes.some(o => Number(positions[o.id]?.shares) > 0)
  const href = `/market/${encodeURIComponent(market.slug || market.id)}`

  const inner = (
    <>
      <span className="mkt-num text-[11px] text-fg-subtle w-10 shrink-0" dir="ltr">{kickoff(market.game?.game_date)}</span>
      {/* Home over away, one team per line — side by side, two Hebrew club
          names left each about six characters on a phone. */}
      <div className="min-w-0 flex-1 space-y-1">
        {[home, away].map((o, i) => o && (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            <TeamLogo team={o.team} size={5} />
            <span className="text-[13px] font-semibold text-fg-strong truncate">{o.label}</span>
          </div>
        ))}
      </div>
      {conflict ? (
        <Lock className="w-3.5 h-3.5 text-fg-subtle shrink-0" aria-label={CONFLICT_COPY[conflict]} />
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {held && <span className="w-1.5 h-1.5 rounded-full bg-brand" title="יש לך תחזית" />}
          {[{ o: home, c: colors.home }, { o: draw, c: null }, { o: away, c: colors.away }].map(({ o, c }, i) => o && (
            <span key={i} className="mkt-num text-[11px] font-bold w-9 sm:w-10 text-center rounded-md py-1.5 bg-surface-sunken"
              style={c ? { color: c } : undefined}>
              {pct(o.price)}
            </span>
          ))}
        </div>
      )}
    </>
  )

  const cls = 'flex items-center gap-2.5 px-3 py-2.5'
  if (conflict) return <div className={`${cls} opacity-60`} title={CONFLICT_COPY[conflict]}>{inner}</div>
  return <Link to={href} className={`${cls} hover:bg-surface-inset transition-colors`}>{inner}</Link>
}
