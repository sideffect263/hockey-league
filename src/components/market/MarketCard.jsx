import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from "lucide-react"
import { ApprovedStatus as CircleCheck, Declined as Ban, TrendUp as TrendingUp, Clock, BrandIcon } from "@/components/icons/BrandIcons"
import { useTheme } from '@/lib/ThemeContext'
import { seriesTeamColors } from '@/lib/teamMarkColor'
import TeamLogo from '@/components/TeamLogo'
import { pct, CONFLICT_COPY } from '@/lib/market'

/** "עוד 3 ימים" / "עוד 4 שעות" — a deadline is more useful than a date here. */
export function closesIn(iso) {
  if (!iso) return null
  const ms = new Date(iso) - new Date()
  if (ms <= 0) return null
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `עוד ${mins} דק׳`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `עוד ${hrs} שעות`
  const days = Math.round(hrs / 24)
  if (days === 1) return 'עוד יום'
  if (days < 30) return `עוד ${days} ימים`
  const months = Math.round(days / 30)
  return months === 1 ? 'עוד חודש' : `עוד ${months} חודשים`
}

export function StatusChip({ market }) {
  if (market.status === 'resolved') {
    return (
      <span className="stat-pill bg-brand/10 text-brand">
        <CircleCheck className="w-4 h-4" /> הוכרע
      </span>
    )
  }
  if (market.status === 'void') {
    return <span className="stat-pill bg-surface-sunken text-fg-muted"><Ban className="w-4 h-4" /> בוטל</span>
  }
  if (market.status === 'closed') {
    return <span className="stat-pill bg-surface-sunken text-fg-muted whitespace-nowrap shrink-0"><Lock className="w-3 h-3" /> סגור לתחזיות</span>
  }
  const t = closesIn(market.closes_at)
  return (
    <span className="stat-pill bg-pos/10 text-pos whitespace-nowrap shrink-0">
      <Clock className="w-4 h-4" /> {t ? `נסגר ${t}` : 'פתוח'}
    </span>
  )
}

// Tailwind's JIT only emits classes it can see as complete literals, so the size
// has to be a lookup rather than an interpolated `w-${size}`.
const FACE_PX = { 6: 'w-6 h-6', 8: 'w-8 h-8', 10: 'w-10 h-10' }

/** Small round face for an outcome — a crest for a team, a photo for a player. */
export function OutcomeFace({ outcome, size = 6 }) {
  if (outcome.team) return <TeamLogo team={outcome.team} size={size} />
  if (outcome.player?.photo_url) {
    return (
      <img src={outcome.player.photo_url} alt="" loading="lazy"
        onError={e => { e.currentTarget.style.display = 'none' }}
        className={`${FACE_PX[size] || FACE_PX[6]} rounded-full object-cover shrink-0 bg-surface-sunken`} />
    )
  }
  // Player cards carry no photos yet: fall back to the club crest they play for.
  if (outcome.markTeam) return <TeamLogo team={outcome.markTeam} size={size} />
  return null
}

/** Bar colours for a season question: the club's hue for team runners, ink for players. */
function useRowColors(outcomes) {
  const { dark } = useTheme()
  return useMemo(() => {
    const teams = outcomes.filter(o => o.team)
    const cs = seriesTeamColors(teams.map(o => ({ color: o.team.primary_color, teamId: o.team.id })), dark)
    const m = new Map(teams.map((o, i) => [o.id, cs[i]]))
    return o => m.get(o.id) || 'rgb(var(--fg-strong))'
  }, [outcomes, dark])
}

/**
 * One market on the board (PredictHome "העונה" card): an icon, the question, how many
 * took part, and the front of the field as bars. Top three by price, because on a
 * 20-runner season question the interesting part is the front, not 5% chances.
 */
export default function MarketCard({ market, myShares = {}, conflict = null, activity = null }) {
  const sorted = [...market.outcomes].sort((a, b) => b.price - a.price)
  const shown = sorted.slice(0, 3)
  const rest = sorted.length - shown.length
  const colorOf = useRowColors(shown)
  // Shares survive settlement as a record of what was held, so a settled market
  // must not advertise them as an open position: a voided market has already
  // refunded them and a resolved one has already paid them out.
  const live = market.status === 'open' || market.status === 'closed'
  const held = live ? market.outcomes.filter(o => myShares[o.id]?.shares > 0) : []
  const winner = market.resolved_outcome_id
    ? market.outcomes.find(o => o.id === market.resolved_outcome_id)
    : null
  const icon = market.kind === 'game' ? 'calendar' : market.outcomes.some(o => o.player) ? 'goal' : 'trophy'

  const body = (
    <>
      <div className="flex items-start gap-2.5 mb-3">
        <BrandIcon name={icon} variant="large" className="w-9 h-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold text-fg-strong leading-snug text-base">{market.title}</h3>
          {market.subtitle && <p className="text-xs text-fg-muted mt-0.5">{market.subtitle}</p>}
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <StatusChip market={market} />
            {activity?.traders > 0 && (
              <span className="text-[12px] text-fg-muted"><span className="fl-num">{activity.traders}</span> חזו</span>
            )}
          </div>
        </div>
      </div>

      {winner && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-pos/10">
          <CircleCheck className="w-4 h-4 text-pos shrink-0" />
          <span className="text-sm font-bold text-fg-strong truncate">{winner.label}</span>
        </div>
      )}

      <div className="space-y-1.5">
        {shown.map(o => {
          const p = Math.round(o.price * 100)
          return (
            <div key={o.id} className="flex items-center gap-2.5 min-h-[30px]">
              <span className={`w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 overflow-hidden ${o.team || o.player || o.markTeam ? 'bg-fl-disc' : ''}`}>
                <OutcomeFace outcome={o} size={6} />
              </span>
              <span className="w-[110px] sm:w-[140px] text-[13.5px] font-semibold text-fg-strong truncate shrink-0">
                {o.label}
                {myShares[o.id]?.shares > 0 && <span className="sr-only"> · שלי</span>}
              </span>
              <span className="flex-1 h-2.5 rounded-full bg-surface-page overflow-hidden" aria-hidden="true">
                <span className="block h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.max(p, 2)}%`, backgroundColor: colorOf(o) }} />
              </span>
              <span className="w-10 text-left mkt-num text-[15px] text-fg-strong shrink-0">{p}%</span>
            </div>
          )
        })}
        {rest > 0 && (
          <p className="text-[12px] text-fg-muted pt-0.5">
            {rest === 1 ? 'ועוד אפשרות אחת' : `ועוד ${rest} אפשרויות`}
          </p>
        )}
      </div>

      {(conflict || held.length > 0) && (
        <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 text-[12px]">
          {conflict ? (
            <span className="flex items-center gap-1.5 text-fg-muted">
              <Lock className="w-3 h-3 shrink-0" /> {CONFLICT_COPY[conflict] || CONFLICT_COPY['own-team']}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-pos font-bold">
              <TrendingUp className="w-4 h-4" /> התחזית שלך: {held.map(o => o.label).join(', ')}
            </span>
          )}
        </div>
      )}
    </>
  )

  if (conflict) {
    return <div className="mkt-card p-3.5 opacity-60 cursor-not-allowed">{body}</div>
  }
  return (
    <Link to={`/market/${encodeURIComponent(market.slug || market.id)}`}
      className="mkt-card-hover p-3.5 block transition-transform hover:-translate-y-0.5">
      {body}
    </Link>
  )
}
