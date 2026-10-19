import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame, Users, BarChart3, ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { coins as fmtCoins, pct, getTrades } from '@/lib/market'
import { StatusChip, OutcomeFace } from '@/components/market/MarketCard'
import PriceChart, { useSeriesColors } from '@/components/market/PriceChart'

/**
 * Change since the market opened, in probability points.
 *
 * Measured against the opening price (1/n) rather than against yesterday: this
 * league trades a handful of times a week, so a 24h window would read "0" on
 * almost every market almost all the time — true, and useless. "Where it started
 * vs where it is" is the move that actually happened.
 */
function Delta({ price, outcomes }) {
  const open = 1 / Math.max(outcomes, 1)
  const d = Math.round((price - open) * 100)
  const Icon = d > 0 ? TrendingUp : d < 0 ? TrendingDown : Minus
  const tone = d > 0 ? 'text-pos' : d < 0 ? 'text-neg' : 'text-fg-subtle'
  return (
    <span className={`flex items-center gap-1 text-[11px] font-bold ${tone}`} dir="ltr"
      title="שינוי מאז פתיחת השוק, בנקודות הסתברות">
      <Icon className="w-3 h-3" />{d > 0 ? '+' : ''}{d}
    </span>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
      <Icon className="w-3.5 h-3.5 text-fg-subtle" />
      {label} <span className="mkt-num font-bold text-fg-soft">{value}</span>
    </span>
  )
}

/**
 * The board's featured slot: one market, big, with its price history.
 *
 * The board is a grid of equal cards, which tells a trader nothing about where
 * the action is — every market looks as important as every other, and the graph
 * that makes a prediction market worth watching was buried a click deep on the
 * detail page. This pulls the live one to the front and puts the chart on the
 * landing screen.
 */
export default function FeaturedMarket({ market, trades, activity }) {
  const colorOf = useSeriesColors(market)
  const sorted = [...market.outcomes].sort((a, b) => b.price - a.price)
  const shown = sorted.slice(0, 3)
  const href = `/market/${encodeURIComponent(market.slug || market.id)}`

  return (
    <section className="mkt-card overflow-hidden border-brand/30">
      <div className="p-4 sm:p-5 bg-gradient-to-bl from-brand/[0.07] to-transparent">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <span className="stat-pill bg-brand/10 text-brand mb-2">
              <Flame className="w-3 h-3" /> שוק מוביל
            </span>
            <h2 className="text-lg sm:text-xl font-black text-fg-strong leading-snug">
              <Link to={href} className="hover:text-brand transition-colors">{market.title}</Link>
            </h2>
            {market.subtitle && <p className="text-xs text-fg-muted mt-0.5">{market.subtitle}</p>}
          </div>
          <StatusChip market={market} />
        </div>

        <div className="grid lg:grid-cols-[1fr_260px] gap-4 lg:gap-5 items-start">
          <div className="min-w-0">
            <PriceChart market={market} trades={trades} variant="hero" />
          </div>

          <div className="space-y-1.5">
            {shown.map(o => (
              <Link key={o.id} to={href}
                className="mkt-bar flex items-center gap-2 px-2.5 py-2 hover:bg-surface-inset transition-colors">
                <div className="mkt-bar-fill" style={{ width: `${Math.round(o.price * 100)}%` }} />
                <div className="relative flex items-center gap-2 min-w-0 flex-1">
                  {/* The row's own line in the chart above it. */}
                  <span className="w-1.5 h-6 rounded-full shrink-0"
                    style={{ backgroundColor: colorOf.get(o.id) || 'transparent' }} />
                  <OutcomeFace outcome={o} size={6} />
                  <span className="text-[13px] font-semibold text-fg-soft truncate">{o.label}</span>
                </div>
                <span className="relative flex items-center gap-2 shrink-0">
                  <Delta price={o.price} outcomes={market.outcomes.length} />
                  <span className="mkt-num text-sm font-bold text-fg-strong">{pct(o.price)}</span>
                </span>
              </Link>
            ))}
            {sorted.length > shown.length && (
              <p className="text-[11px] text-fg-subtle px-2.5 pt-0.5">
                {sorted.length - shown.length === 1
                  ? 'ועוד אפשרות אחת'
                  : `ועוד ${sorted.length - shown.length} אפשרויות`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-5 py-2.5 border-t border-line-subtle flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <Stat icon={BarChart3} label="נפח" value={fmtCoins(activity?.volume || 0)} />
          <Stat icon={Users} label="סוחרים" value={activity?.traders || 0} />
        </div>
        <Link to={href} className="inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline">
          למסחר <ArrowLeft className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  )
}

const ROTATE_MS = 5000

/**
 * The featured slot with up to three markets taking turns, one every 5 s.
 *
 * Rotation stops while the pointer or keyboard focus is on the card (so it does
 * not change under someone reading or about to tap) and while the tab is hidden;
 * the dots underneath jump straight to a market. Each market's tape is fetched
 * once, as it first comes up, and kept for the next lap.
 */
export function FeaturedCarousel({ markets, activity }) {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [trades, setTrades] = useState({})
  const count = markets.length
  const i = idx < count ? idx : 0
  const market = markets[i]

  useEffect(() => {
    if (count < 2 || paused) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setIdx(n => (n + 1) % count)
    }, ROTATE_MS)
    return () => clearInterval(t)
  }, [count, paused, i])

  useEffect(() => {
    if (!market || trades[market.id]) return
    let alive = true
    getTrades(market.id)
      .then(t => { if (alive) setTrades(prev => ({ ...prev, [market.id]: t })) })
      .catch(() => {})
    return () => { alive = false }
  }, [market?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!market) return null

  return (
    <div className="mb-6"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div key={market.id} className="mkt-fade">
        <FeaturedMarket market={market} trades={trades[market.id] || null} activity={activity.get(market.id)} />
      </div>
      {count > 1 && (
        <div className="flex justify-center gap-1.5 mt-3" role="tablist" aria-label="שווקים מובילים">
          {markets.map((m, n) => (
            <button key={m.id} type="button" role="tab" aria-selected={n === i} aria-label={m.title}
              onClick={() => setIdx(n)}
              className={`h-1.5 rounded-full transition-all ${n === i ? 'w-6 bg-brand' : 'w-1.5 bg-fg-subtle/40 hover:bg-fg-subtle'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
