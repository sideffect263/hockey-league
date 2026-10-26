import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Lock, ChevronLeft } from "lucide-react"
import { Squad as Users, TrendUp as TrendingUp } from "@/components/icons/BrandIcons"
import TeamLogo from '@/components/TeamLogo'
import { useTheme } from '@/lib/ThemeContext'
import { seriesTeamColors } from '@/lib/teamMarkColor'
import { pct, gameSides, CONFLICT_COPY } from '@/lib/market'
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

function Side({ outcome, color, align, mine }) {
  if (!outcome) return <div className="flex-1" />
  return (
    <div className={`flex-1 min-w-0 flex flex-col items-center gap-1.5 text-center`}>
      <div className="relative">
        <TeamLogo team={outcome.team} size={12} />
        {mine && (
          <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-brand ring-2 ring-surface flex items-center justify-center"
            title="יש לך פוזיציה כאן">
            <TrendingUp className="w-4 h-4 text-brand-fg" />
          </span>
        )}
      </div>
      <span className="text-[13px] font-bold text-fg-strong leading-tight line-clamp-2">{outcome.label}</span>
      <span className="mkt-num text-lg font-black leading-none" style={{ color }} data-align={align}>
        {pct(outcome.price)}
      </span>
    </div>
  )
}

/**
 * A fixture on the board, head to head: both crests, the kickoff between them,
 * and the odds as one split bar. Built for the next matchday, where a trader
 * decides — later rounds use the compact GameRow below.
 */
export default function MatchCard({ market, positions = {}, conflict = null, activity = null }) {
  const { home, draw, away } = gameSides(market)
  const colors = useSideColors(home, away)
  const mineOf = o => o && Number(positions[o.id]?.shares) > 0
  const heldAny = market.outcomes.some(mineOf)
  const href = `/market/${encodeURIComponent(market.slug || market.id)}`

  const body = (
    <>
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-[11px] font-semibold text-fg-muted truncate">
          {market.game?.venue || market.subtitle || 'מי ינצח?'}
        </span>
        {conflict
          ? <span className="stat-pill bg-surface-sunken text-fg-muted"><Lock className="w-3 h-3" /> חסום עבורך</span>
          : <StatusChip market={market} />}
      </div>

      <div className="flex items-start gap-2">
        <Side outcome={home} color={colors.home} align="home" mine={mineOf(home)} />
        <div className="shrink-0 flex flex-col items-center pt-3 px-1">
          <span className="mkt-num text-sm font-black text-fg-strong" dir="ltr">{kickoff(market.game?.game_date)}</span>
          <span className="text-[10px] font-bold text-fg-subtle tracking-widest mt-0.5">VS</span>
          {draw && (
            <span className="mt-2 text-[10px] text-fg-muted whitespace-nowrap">
              תיקו <span className="mkt-num font-bold text-fg-soft">{pct(draw.price)}</span>
            </span>
          )}
        </div>
        <Side outcome={away} color={colors.away} align="away" mine={mineOf(away)} />
      </div>

      <div className="mt-3">
        <SplitBar home={home} draw={draw} away={away} colors={colors} />
      </div>

      <div className="mt-3 pt-2.5 border-t border-line-subtle flex items-center gap-3 text-[11px]">
        {conflict ? (
          <span className="flex items-center gap-1.5 text-fg-muted">
            <Lock className="w-3 h-3 shrink-0" /> {CONFLICT_COPY[conflict] || CONFLICT_COPY['own-team']}
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1 text-fg-muted">
              <Users className="w-4 h-4" />
              {activity?.traders
                ? <>{activity.traders === 1 ? 'מהמר אחד' : <><span className="mkt-num font-bold text-fg-soft">{activity.traders}</span> מהמרים</>}</>
                : 'עוד אין הימורים — היה הראשון'}
            </span>
            {heldAny && (
              <span className="stat-pill bg-brand/15 text-brand text-[10px] px-1.5 py-0">שלי</span>
            )}
            <span className="ms-auto inline-flex items-center gap-0.5 font-bold text-brand">
              להימור <ChevronLeft className="w-3.5 h-3.5" />
            </span>
          </>
        )}
      </div>
    </>
  )

  if (conflict) {
    return <div className="mkt-card p-4 bg-surface-inset/60">{body}</div>
  }
  return (
    <Link to={href}
      className={`mkt-card-hover p-4 block transition-all hover:-translate-y-0.5 hover:shadow-md ${heldAny ? 'border-s-4 border-s-brand' : ''}`}>
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
          {held && <span className="w-1.5 h-1.5 rounded-full bg-brand" title="יש לך פוזיציה" />}
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
