import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowRight, MapPin, CalendarDays, Lock, Coins, Droplets } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  getBlockReason, getWallet, listMarkets, getMyPositions, getTrades, getConflicts,
  coins as fmtCoins, pct,
} from '@/lib/market'
import MarketGate from '@/components/market/MarketGate'
import { StatusChip, OutcomeFace, closesIn } from '@/components/market/MarketCard'
import TradeTicket from '@/components/market/TradeTicket'
import PriceChart from '@/components/market/PriceChart'
import { useMarketTheme } from './Market'
import { MarketDetailSkeleton } from "@/components/skeletons/PageSkeletons"

export default function MarketDetail() {
  useMarketTheme()
  // /market/:key — a slug (הוקי-מרקט question) or a UUID from an older link.
  // Markets are RLS-gated, so this resolves off the list the page already loads
  // rather than through useSlugId, which would fire a query a blocked viewer
  // isn't allowed to make anyway.
  const { id: routeKey } = useParams()
  const { user, loading: authLoading } = useAuth()

  const [reason, setReason] = useState(undefined)
  const [market, setMarket] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [positions, setPositions] = useState({})
  const [trades, setTrades] = useState([])
  const [conflict, setConflict] = useState(null)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    const r = await getBlockReason()
    setReason(r)
    if (r) return
    const [w, ms, ps, cs] = await Promise.all([
      getWallet().catch(() => null),
      listMarkets().catch(() => []),
      getMyPositions().catch(() => ({})),
      getConflicts().catch(() => new Map()),
    ])
    const m = ms.find(x => x.slug === routeKey || x.id === routeKey)
    // Trades key off the market's UUID, so they can only be fetched once the
    // slug has been matched — one round trip later than the rest.
    const ts = m ? await getTrades(m.id).catch(() => []) : []
    setWallet(w); setPositions(ps); setTrades(ts)
    setConflict(m ? (cs.get(m.id) ?? null) : null); setMarket(m || null); setMissing(!m)
  }, [routeKey])

  useEffect(() => {
    if (authLoading) return
    if (!user) { setReason('signed-out'); return }
    load()
  }, [authLoading, user, load])

  if (authLoading || reason === undefined) {
    return <MarketDetailSkeleton />
  }
  if (reason) return <MarketGate reason={reason} onUnlocked={load} />
  if (missing) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-fg-muted mb-4">השוק הזה לא נמצא</p>
        <Link to="/market" className="btn-secondary inline-flex">חזרה להוקי מרקט</Link>
      </div>
    )
  }
  if (!market) {
    return <MarketDetailSkeleton />
  }

  const mine = market.outcomes
    .map(o => ({ o, p: positions[o.id] }))
    .filter(x => Number(x.p?.shares) > 0)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <Link to="/market" className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted hover:text-brand transition-colors mb-4">
        <ArrowRight className="w-3.5 h-3.5" /> הוקי מרקט
      </Link>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-xl sm:text-2xl font-black text-fg-strong leading-tight">{market.title}</h1>
        <StatusChip market={market} />
      </div>
      {market.subtitle && <p className="text-sm text-fg-muted mb-3">{market.subtitle}</p>}

      <div className="flex items-center gap-4 flex-wrap text-[11px] text-fg-subtle mb-5">
        {market.game?.game_date && (
          <span className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            <span dir="ltr">{new Date(market.game.game_date).toLocaleString('he-IL', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })}</span>
          </span>
        )}
        {market.game?.venue && (
          <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{market.game.venue}</span>
        )}
        {market.status === 'open' && closesIn(market.closes_at) && (
          <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />נסגר {closesIn(market.closes_at)}</span>
        )}
        <span className="flex items-center gap-1.5" title="נזילות: ככל שהיא גבוהה יותר, הימור נתון מזיז פחות את המחיר">
          <Droplets className="w-3.5 h-3.5" />נזילות <span className="mkt-num">{fmtCoins(market.b)}</span>
        </span>
      </div>

      {market.resolution_note && (
        <p className="mkt-card px-4 py-2.5 text-xs text-fg-muted mb-5">{market.resolution_note}</p>
      )}

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <PriceChart market={market} trades={trades} />

          {mine.length > 0 && (
            <div className="mkt-card p-4">
              <h2 className="section-head text-sm mb-3"><Coins className="w-4 h-4 text-brand" /> הפוזיציה שלי</h2>
              <div className="space-y-2">
                {mine.map(({ o, p }) => {
                  const shares = Number(p.shares)
                  const cost = Number(p.cost_basis)
                  // Once settled the position is history, so show what it actually
                  // returned: a winning share paid 1 coin, a losing one paid 0, and
                  // a void refunded the stake. Marking a settled winner to a price
                  // of zero would report a paid-out win as a total loss.
                  const settledValue =
                    market.status === 'void' ? cost
                    : market.status === 'resolved'
                      ? (o.id === market.resolved_outcome_id ? shares : 0)
                      : null
                  const value = settledValue ?? shares * o.price
                  const pnl = value - cost
                  return (
                    <div key={o.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-inset">
                      <OutcomeFace outcome={o} size={6} />
                      <span className="font-semibold text-sm text-fg-soft truncate flex-1">{o.label}</span>
                      <span className="mkt-num text-xs text-fg-muted">{shares.toFixed(1)} מניות</span>
                      <span className={`mkt-num text-sm font-bold ${pnl >= 0 ? 'text-pos' : 'text-neg'}`} dir="ltr">
                        {pnl >= 0 ? '+' : ''}{fmtCoins(pnl)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <Tape trades={trades} market={market} />
        </div>

        <div>
          {conflict ? (
            <div className="mkt-card p-6 text-center">
              <Lock className="w-6 h-6 text-fg-subtle mx-auto mb-3" />
              <p className="text-sm font-bold text-fg-strong mb-1">השוק הזה חסום עבורך</p>
              <p className="text-xs text-fg-muted leading-relaxed">
                {conflict === 'referee'
                  ? 'אי אפשר לסחור על משחק שאתה משובץ לשפוט.'
                  : 'אי אפשר לסחור על משחק שהקבוצה שלך משחקת בו.'}
              </p>
            </div>
          ) : (
            <TradeTicket
              market={market} balance={wallet?.balance ?? 0}
              position={positions} onTraded={load}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** The tape. Public, as on a real exchange — seeing the flow is half the fun. */
function Tape({ trades, market }) {
  if (!trades.length) return null
  const label = id => market.outcomes.find(o => o.id === id)?.label || '—'
  return (
    <div className="mkt-card overflow-hidden">
      <h2 className="section-head text-sm px-4 py-3 border-b border-line-subtle">פעילות אחרונה</h2>
      <ul className="divide-y divide-line-subtle max-h-80 overflow-y-auto">
        {trades.map(t => (
          <li key={t.id} className="flex items-center gap-2.5 px-4 py-2 text-xs">
            <span className={`stat-pill text-[10px] px-1.5 py-0 ${
              t.side === 'buy' ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg'
            }`}>{t.side === 'buy' ? 'קנה' : 'מכר'}</span>
            <span className="font-semibold text-fg-soft truncate">{t.trader?.display_name || 'שחקן'}</span>
            <span className="text-fg-muted truncate">{label(t.outcome_id)}</span>
            <span className="ms-auto mkt-coin text-[11px] shrink-0">{fmtCoins(t.coins)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
