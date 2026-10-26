import { useState, useMemo, useEffect } from 'react'
import { Loader2, ArrowLeftRight, Lock, Search, X, Check } from "lucide-react"
import { TrendUp as TrendingUp, TrendDown as TrendingDown, Coin as Coins } from "@/components/icons/BrandIcons"
import {
  prices, sharesForCoins, coinsForShares, avgPrice, pct, coins as fmtCoins, buy, sell, invalidateBoard,
} from '@/lib/market'
import { OutcomeFace } from './MarketCard'

const QUICK = [25, 50, 100, 250]

/**
 * Runners shown before the picker starts hiding the tail behind a search box.
 * A season market now carries the whole league — 98 rows — and a sticky sidebar
 * that tall is a scroll, not a choice.
 */
const CROWD = 10

/**
 * Buy and sell one outcome.
 *
 * Every figure updates on the keystroke, priced by the same LMSR curve the server
 * runs — so the quote a trader accepts is the quote they get. The two numbers
 * that matter are shown without being asked for: the average price this stake
 * actually pays (not the screen price, which is only the price of the very first
 * share) and the payout if it lands. Slippage is the thing an AMM hides from you
 * if you let it.
 */
export default function TradeTicket({ market, balance, position, onTraded }) {
  const [side, setSide] = useState('buy')
  const [selected, setSelected] = useState(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const [celebrate, setCelebrate] = useState(null)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const tradable = market.status === 'open'
  const outcomes = useMemo(
    () => [...market.outcomes].sort((a, b) => b.price - a.price),
    [market.outcomes]
  )
  const crowded = outcomes.length > CROWD

  // Default to the favourite, and keep the selection valid across refreshes.
  useEffect(() => {
    if (!selected || !market.outcomes.some(o => o.id === selected)) {
      setSelected(outcomes[0]?.id ?? null)
    }
  }, [market.id, outcomes, selected, market.outcomes])

  // The field, narrowed. A search hit wins over the price ordering, and the
  // current pick is always drawn even when it sits sixty rows down — otherwise
  // the form below quietly refers to a runner who is nowhere on screen.
  const visible = useMemo(() => {
    if (!crowded) return outcomes
    const q = query.trim().toLowerCase()
    const base = q
      ? outcomes.filter(o => o.label.toLowerCase().includes(q))
      : showAll ? outcomes : outcomes.slice(0, CROWD)
    const pick = outcomes.find(o => o.id === selected)
    return pick && !base.includes(pick) ? [...base, pick] : base
  }, [outcomes, crowded, query, showAll, selected])

  const idx = market.outcomes.findIndex(o => o.id === selected)
  const outcome = idx >= 0 ? market.outcomes[idx] : null
  const held = Number(position?.[selected]?.shares || 0)
  const b = Number(market.b)
  const qs = market.outcomes.map(o => Number(o.q))

  const preview = useMemo(() => {
    const n = Number(amount)
    if (!outcome || !(n > 0)) return null
    if (side === 'buy') {
      const shares = sharesForCoins(qs, b, idx, n)
      if (!(shares > 0)) return null
      const after = qs.slice(); after[idx] += shares
      return {
        shares,
        avg: avgPrice(n, shares),
        payout: shares,
        profit: shares - n,
        newPrice: prices(after, b)[idx],
      }
    }
    const shares = Math.min(n, held)
    if (!(shares > 0)) return null
    const proceeds = coinsForShares(qs, b, idx, shares)
    const after = qs.slice(); after[idx] -= shares
    return {
      shares, proceeds, avg: avgPrice(proceeds, shares), newPrice: prices(after, b)[idx],
    }
  }, [amount, side, idx, held, b, qs, outcome])

  const overBalance = side === 'buy' && Number(amount) > Number(balance)
  const overHolding = side === 'sell' && Number(amount) > held

  const submit = async (e) => {
    e.preventDefault()
    if (!outcome || !preview || busy) return
    setBusy(true); setErr(null); setDone(null)
    try {
      const n = Number(amount)
      const r = side === 'buy'
        ? await buy(outcome.id, n)
        : await sell(outcome.id, Math.min(n, held))
      invalidateBoard()
      if (side === 'buy') {
        // The moment a bet lands is the one moment the market should feel like a
        // game rather than a form — so it gets a beat of its own.
        setCelebrate({ label: outcome.label, stake: n, payout: Number(r.shares) })
      } else {
        setDone(`התקבלו ${fmtCoins(r.coins)} מטבעות`)
      }
      setAmount('')
      await onTraded?.()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!celebrate) return
    const t = setTimeout(() => setCelebrate(null), 3200)
    return () => clearTimeout(t)
  }, [celebrate])

  return (
    <div className="mkt-card p-4 sticky top-20 relative overflow-hidden">
      {celebrate && <Celebration {...celebrate} onClose={() => setCelebrate(null)} />}
      {/* Outcome picker */}
      {crowded && (
        <div className="relative mb-2">
          <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-3.5 h-3.5 text-fg-subtle pointer-events-none" />
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={`חיפוש בין ${outcomes.length} האפשרויות…`}
            className="w-full bg-surface-inset border border-line rounded-lg ps-8 pe-7 py-2 text-[13px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="ניקוי חיפוש"
              className="absolute top-1/2 -translate-y-1/2 end-2 text-fg-subtle hover:text-fg-soft">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className={`space-y-1.5 mb-4 ${crowded ? 'max-h-[22rem] overflow-y-auto' : ''}`}>
        {visible.map(o => {
          const mine = Number(position?.[o.id]?.shares || 0)
          const active = o.id === selected
          return (
            <button
              key={o.id} type="button" onClick={() => { setSelected(o.id); setErr(null); setDone(null) }}
              className={`mkt-bar w-full flex items-center gap-2 px-2.5 py-2 text-start transition-shadow ${
                active ? 'ring-2 ring-brand' : 'hover:ring-1 hover:ring-line-strong'
              }`}
            >
              <div className="mkt-bar-fill" style={{ width: `${Math.round(o.price * 100)}%` }} />
              <div className="relative flex items-center gap-2 min-w-0 flex-1">
                <OutcomeFace outcome={o} size={6} />
                <span className="text-[13px] font-semibold text-fg-soft truncate">{o.label}</span>
                {mine > 0 && (
                  <span className="stat-pill bg-brand/15 text-brand text-[10px] px-1.5 py-0 shrink-0 mkt-num">
                    {mine.toFixed(0)}
                  </span>
                )}
              </div>
              <span className="relative mkt-num text-sm font-bold text-fg-strong shrink-0">{pct(o.price)}</span>
            </button>
          )
        })}

        {crowded && query && !visible.some(o => o.label.toLowerCase().includes(query.trim().toLowerCase())) && (
          <p className="text-[11px] text-fg-subtle text-center py-2">לא נמצאה אפשרות בשם הזה</p>
        )}
        {crowded && !query && (
          <button type="button" onClick={() => setShowAll(v => !v)}
            className="w-full py-1.5 text-[11px] font-bold text-brand hover:underline">
            {showAll ? 'הצג רק את המובילים' : `הצג את כל ${outcomes.length} האפשרויות`}
          </button>
        )}
      </div>

      {!tradable ? (
        <div className="flex items-center gap-2 justify-center py-4 text-sm text-fg-muted">
          <Lock className="w-4 h-4" />
          {market.status === 'resolved' ? 'השוק הוכרע' :
           market.status === 'void' ? 'השוק בוטל וההימורים הוחזרו' : 'המסחר נסגר'}
        </div>
      ) : (
        <form onSubmit={submit}>
          {/* Buy / sell */}
          <div className="tab-bar mb-3">
            <button type="button" onClick={() => { setSide('buy'); setAmount(''); setErr(null) }}
              className={side === 'buy' ? 'tab-active' : 'tab-inactive'}>
              <TrendingUp className="w-4 h-4" /> קנייה
            </button>
            <button type="button" onClick={() => { setSide('sell'); setAmount(''); setErr(null) }}
              disabled={held <= 0}
              className={`${side === 'sell' ? 'tab-active' : 'tab-inactive'} disabled:opacity-40 disabled:cursor-not-allowed`}>
              <TrendingDown className="w-4 h-4" /> מכירה
            </button>
          </div>

          <label className="block mb-2">
            <span className="flex items-center justify-between text-xs font-semibold text-fg-muted mb-1.5">
              <span>{side === 'buy' ? 'סכום במטבעות' : 'כמות מניות'}</span>
              <span className="mkt-num">
                {side === 'buy'
                  ? `יתרה ${fmtCoins(balance)}`
                  : `מחזיק ${held.toFixed(1)}`}
              </span>
            </span>
            <input
              type="number" inputMode="decimal" min="0" step="any" dir="ltr"
              value={amount} onChange={e => { setAmount(e.target.value); setErr(null); setDone(null) }}
              placeholder="0"
              className="w-full bg-surface-inset border border-line rounded-lg px-3 py-2.5 mkt-num text-lg font-bold text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </label>

          <div className="flex gap-1.5 mb-3">
            {side === 'buy'
              ? QUICK.map(v => (
                  <button key={v} type="button" onClick={() => setAmount(String(v))}
                    disabled={v > Number(balance)}
                    className="flex-1 py-1.5 rounded-lg bg-surface-sunken text-fg-muted mkt-num text-xs font-bold hover:text-brand transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    {v}
                  </button>
                ))
              : [0.25, 0.5, 1].map(f => (
                  <button key={f} type="button" onClick={() => setAmount(String(+(held * f).toFixed(6)))}
                    className="flex-1 py-1.5 rounded-lg bg-surface-sunken text-fg-muted mkt-num text-xs font-bold hover:text-brand transition-colors">
                    {f === 1 ? 'הכל' : `${f * 100}%`}
                  </button>
                ))}
          </div>

          {preview && (
            <dl className="space-y-1.5 mb-3 px-3 py-2.5 rounded-lg bg-surface-inset text-xs">
              {side === 'buy' ? (
                <>
                  {/* The bet slip's headline: what this stake turns into. The
                      mechanics (shares, average price) stay, but underneath. */}
                  <div className="-mx-3 -mt-2.5 mb-2 px-3 py-3 rounded-t-lg bg-brand/10 border-b border-brand/20">
                    <p className="text-[11px] text-fg-muted">
                      אם <span className="font-bold text-fg-strong">{outcome.label}</span> — תקבל
                    </p>
                    <div className="flex items-baseline justify-between gap-2 mt-0.5">
                      <span className="mkt-coin text-3xl flex items-center gap-1.5">
                        <Coins className="w-6 h-6" />{fmtCoins(preview.payout)}
                      </span>
                      <span className="stat-pill bg-pos/15 text-pos mkt-num" dir="ltr">
                        ×{(preview.payout / Number(amount)).toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[11px] text-pos font-bold mt-0.5" dir="rtl">
                      רווח של <span className="mkt-num">+{fmtCoins(preview.profit)}</span>
                    </p>
                  </div>
                  <Row label="מניות" value={preview.shares.toFixed(1)} />
                  <Row label="מחיר ממוצע" value={pct(preview.avg)} />
                </>
              ) : (
                <>
                  <Row label="תקבל" value={fmtCoins(preview.proceeds)} accent />
                  <Row label="מחיר ממוצע" value={pct(preview.avg)} />
                </>
              )}
              <Row label="מחיר אחרי" value={`${pct(outcome.price)} ← ${pct(preview.newPrice)}`} />
            </dl>
          )}

          {overBalance && <p className="text-xs text-neg mb-2">אין לך מספיק מטבעות</p>}
          {overHolding && <p className="text-xs text-neg mb-2">אין לך מספיק מניות</p>}
          {err && <p className="text-xs text-neg mb-2">{err}</p>}
          {done && <p className="text-xs text-brand font-semibold mb-2">{done}</p>}

          <button type="submit"
            disabled={busy || !preview || overBalance || overHolding}
            className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            {side === 'buy'
              ? (preview ? `הימור ${fmtCoins(Number(amount))} על ${outcome?.label}` : 'קנייה')
              : 'מכירה'}
          </button>
        </form>
      )}
    </div>
  )
}

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`mkt-num font-bold ${accent ? 'text-brand' : 'text-fg-soft'}`} dir="ltr">{value}</dd>
    </div>
  )
}

/**
 * The filled-bet moment: a check that pops, a burst of coins, and the one
 * number the trader cares about. Dismisses itself; a tap dismisses it sooner.
 */
function Celebration({ label, stake, payout, onClose }) {
  return (
    <button type="button" onClick={onClose}
      className="absolute inset-0 z-10 bg-surface/95 backdrop-blur-sm flex flex-col items-center justify-center text-center px-6"
      aria-live="polite">
      <div className="relative mb-3">
        <div className="mkt-burst absolute inset-0" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 36}deg`, animationDelay: `${(i % 3) * 40}ms` }} />
          ))}
        </div>
        <span className="mkt-pop relative w-16 h-16 rounded-full bg-brand flex items-center justify-center shadow-lg">
          <Check className="w-8 h-8 text-brand-fg" strokeWidth={3} />
        </span>
      </div>
      <p className="text-lg font-black text-fg-strong">ההימור נכנס!</p>
      <p className="text-sm text-fg-muted mt-1">
        <span className="mkt-coin">{fmtCoins(stake)}</span> על <span className="font-bold text-fg-soft">{label}</span>
      </p>
      <p className="text-xs text-fg-subtle mt-3">אם זה יקרה תקבל</p>
      <p className="mkt-coin text-2xl mkt-pop" style={{ animationDelay: '150ms' }}>{fmtCoins(payout)}</p>
    </button>
  )
}
