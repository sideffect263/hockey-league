import { Link } from 'react-router-dom'
import { Lock, CircleCheck, Ban, Clock, TrendingUp, Flame } from 'lucide-react'
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
        <CircleCheck className="w-3 h-3" /> הוכרע
      </span>
    )
  }
  if (market.status === 'void') {
    return <span className="stat-pill bg-surface-sunken text-fg-muted"><Ban className="w-3 h-3" /> בוטל</span>
  }
  if (market.status === 'closed') {
    return <span className="stat-pill bg-surface-sunken text-fg-muted"><Lock className="w-3 h-3" /> סגור למסחר</span>
  }
  const t = closesIn(market.closes_at)
  return (
    <span className="stat-pill bg-pos/10 text-pos">
      <Clock className="w-3 h-3" /> {t ? `נסגר ${t}` : 'פתוח'}
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
  return null
}

/**
 * One market on the board. Shows the top outcomes by price, because on a
 * 20-runner futures market the interesting information is the front of the
 * field, not an alphabetical wall of 5% chances.
 */
export default function MarketCard({ market, myShares = {}, conflict = null }) {
  const sorted = [...market.outcomes].sort((a, b) => b.price - a.price)
  const shown = sorted.slice(0, 3)
  const rest = sorted.length - shown.length
  // Shares survive settlement as a record of what was held, so a settled market
  // must not advertise them as an open position: a voided market has already
  // refunded them and a resolved one has already paid them out.
  const live = market.status === 'open' || market.status === 'closed'
  const held = live ? market.outcomes.filter(o => myShares[o.id]?.shares > 0) : []
  const winner = market.resolved_outcome_id
    ? market.outcomes.find(o => o.id === market.resolved_outcome_id)
    : null

  const body = (
    <>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-extrabold text-fg-strong leading-snug text-[15px]">{market.title}</h3>
          {market.subtitle && (
            <p className="text-xs text-fg-muted mt-0.5">{market.subtitle}</p>
          )}
        </div>
        <StatusChip market={market} />
      </div>

      {winner && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-brand/10">
          <CircleCheck className="w-4 h-4 text-brand shrink-0" />
          <span className="text-sm font-bold text-fg-strong truncate">{winner.label}</span>
        </div>
      )}

      <div className="space-y-1.5">
        {shown.map((o, i) => {
          const leading = i === 0 && shown.length > 1
          return (
            <div key={o.id}
              className={`mkt-bar flex items-center gap-2 px-2.5 py-2 ${leading ? 'ring-1 ring-inset ring-brand/30' : ''}`}>
              <div className={`mkt-bar-fill ${leading ? 'bg-brand/25' : ''}`} style={{ width: `${Math.round(o.price * 100)}%` }} />
              <div className="relative flex items-center gap-2 min-w-0 flex-1">
                <OutcomeFace outcome={o} size={6} />
                <span className="text-[13px] font-semibold text-fg-soft truncate">{o.label}</span>
                {leading && <Flame className="w-3 h-3 text-gold shrink-0" />}
                {myShares[o.id]?.shares > 0 && (
                  <span className="stat-pill bg-brand/15 text-brand text-[10px] px-1.5 py-0 shrink-0">שלי</span>
                )}
              </div>
              <span className={`relative mkt-num text-sm font-bold shrink-0 ${leading ? 'text-brand' : 'text-fg-strong'}`}>
                {pct(o.price)}
              </span>
            </div>
          )
        })}
        {rest > 0 && (
          <p className="text-[11px] text-fg-subtle px-2.5 pt-0.5">ועוד {rest} אפשרויות</p>
        )}
      </div>

      {(conflict || held.length > 0) && (
        <div className="mt-3 pt-3 border-t border-line-subtle flex items-center gap-2 text-[11px]">
          {conflict ? (
            <span className="flex items-center gap-1.5 text-fg-muted">
              <Lock className="w-3 h-3 shrink-0" /> {CONFLICT_COPY[conflict] || CONFLICT_COPY['own-team']}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-brand font-semibold">
              <TrendingUp className="w-3 h-3" /> יש לך פוזיציה פתוחה
            </span>
          )}
        </div>
      )}
    </>
  )

  if (conflict) {
    return <div className="mkt-card p-4 opacity-60 cursor-not-allowed">{body}</div>
  }
  return (
    <Link to={`/market/${encodeURIComponent(market.slug || market.id)}`}
      className="mkt-card-hover p-4 block transition-all hover:-translate-y-0.5 hover:shadow-md">
      {body}
    </Link>
  )
}
