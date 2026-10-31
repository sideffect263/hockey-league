import { useState, useMemo, useEffect } from 'react'
import { Loader2, Lock, Search, X, Check, Minus, Plus } from "lucide-react"
import {
  prices, sharesForCoins, coinsForShares, avgPrice, pct, coins as fmtCoins, buy, sell, invalidateBoard,
} from '@/lib/market'
import { OutcomeFace } from './MarketCard'
import { MoreCoin } from '@/components/fl/more/MoreKit'

const QUICK = [50, 100, 250]
const STEP = 10

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
export default function TradeTicket({ market, balance, position, onTraded, initialSide = 'buy', initialOutcome = null, bare = false }) {
  const [side, setSide] = useState(initialSide)
  const [selected, setSelected] = useState(initialOutcome)
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
        setDone(`יצאת מהתחזית — חזרו ${fmtCoins(r.coins)} סטופרים`)
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

  // Nothing held (or it was all closed): only the predict side makes sense.
  useEffect(() => { if (held <= 0 && side === 'sell') setSide('buy') }, [held, side])

  // A game's three outcomes read as the board's radio tiles, home on the right.
  const sides = market.kind === 'game'
    ? ['home', 'draw', 'away'].map(k => market.outcomes.find(o => o.okey === k)).filter(Boolean)
    : null
  const gameTiles = sides && sides.length === market.outcomes.length
  const ifLabel = o => !o ? '' : market.kind === 'game'
    ? (o.okey === 'draw' ? 'אם יהיה תיקו' : `אם ${o.label} מנצחת`)
    : `אם ${o.label}`
  const stake = Number(amount) || 0
  const setStake = v => { setAmount(v > 0 ? String(v) : ''); setErr(null); setDone(null) }

  return (
    <div className={bare ? 'relative' : 'mkt-card p-4 sticky top-20 relative overflow-hidden'}>
      {celebrate && <Celebration {...celebrate} onClose={() => setCelebrate(null)} />}

      {gameTiles ? (
        <div role="radiogroup" aria-label="התוצאה" className="grid grid-cols-3 gap-2 mb-4">
          {sides.map(o => {
            const on = o.id === selected
            const mine = Number(position?.[o.id]?.shares || 0)
            return (
              <button key={o.id} type="button" role="radio" aria-checked={on}
                onClick={() => { setSelected(o.id); setErr(null); setDone(null) }}
                className={`min-h-[64px] rounded-control border-2 flex flex-col items-center justify-center gap-0.5 px-1 text-[13px] font-bold text-fg-strong transition-colors ${
                  on ? 'border-pos bg-pos/10' : 'border-line bg-surface-inset hover:border-line-strong'}`}>
                <span className={`fl-num text-[20px] ${on ? 'text-pos' : ''}`}>{pct(o.price)}</span>
                <span className="max-w-full truncate">{o.okey === 'draw' ? 'תיקו' : o.label}</span>
                {mine > 0 && <span className="text-[10px] font-semibold text-fg-muted">יש לך תחזית</span>}
              </button>
            )
          })}
        </div>
      ) : (
        <>
          {/* Outcome picker */}
          {crowded && (
            <div className="relative mb-2">
              <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-fg-subtle pointer-events-none" />
              <input
                type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder={`חיפוש בין ${outcomes.length} האפשרויות…`}
                className="w-full min-h-[44px] bg-surface-inset border border-line rounded-control ps-9 pe-9 py-2 text-[14px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="ניקוי חיפוש"
                  className="absolute top-1/2 -translate-y-1/2 end-1 w-10 h-10 flex items-center justify-center text-fg-subtle hover:text-fg-soft">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <div role="radiogroup" aria-label="האפשרויות" className={`space-y-1.5 mb-4 ${crowded ? 'max-h-[22rem] overflow-y-auto' : ''}`}>
            {visible.map(o => {
              const mine = Number(position?.[o.id]?.shares || 0)
              const active = o.id === selected
              return (
                <button
                  key={o.id} type="button" role="radio" aria-checked={active}
                  onClick={() => { setSelected(o.id); setErr(null); setDone(null) }}
                  className={`mkt-bar w-full min-h-[44px] flex items-center gap-2 px-2.5 py-2 text-start border-2 transition-colors ${
                    active ? 'border-pos' : 'border-transparent hover:border-line-strong'
                  }`}
                >
                  <div className="mkt-bar-fill" style={{ width: `${Math.round(o.price * 100)}%` }} />
                  <div className="relative flex items-center gap-2 min-w-0 flex-1">
                    <OutcomeFace outcome={o} size={6} />
                    <span className="text-[13.5px] font-semibold text-fg-strong truncate">{o.label}</span>
                    {mine > 0 && <span className="text-[11px] font-semibold text-pos shrink-0">יש לך תחזית</span>}
                  </div>
                  <span className="relative mkt-num text-sm text-fg-strong shrink-0">{pct(o.price)}</span>
                </button>
              )
            })}

            {crowded && query && !visible.some(o => o.label.toLowerCase().includes(query.trim().toLowerCase())) && (
              <p className="text-[12px] text-fg-muted text-center py-2">לא נמצאה אפשרות בשם הזה</p>
            )}
            {crowded && !query && (
              <button type="button" onClick={() => setShowAll(v => !v)}
                className="w-full min-h-[44px] text-[13px] font-bold text-fg-strong underline underline-offset-4">
                {showAll ? 'הצג רק את המובילים' : `הצג את כל ${outcomes.length} האפשרויות`}
              </button>
            )}
          </div>
        </>
      )}

      {!tradable ? (
        <div className="flex items-center gap-2 justify-center py-4 text-sm text-fg-muted">
          <Lock className="w-4 h-4" />
          {market.status === 'resolved' ? 'השאלה הוכרעה' :
           market.status === 'void' ? 'השאלה בוטלה והסטופרים הוחזרו' : 'התחזיות נסגרו'}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          {held > 0 && (
            <div className="tab-bar">
              <button type="button" onClick={() => { setSide('buy'); setAmount(''); setErr(null) }}
                className={side === 'buy' ? 'tab-active' : 'tab-inactive'}>
                לחזות
              </button>
              <button type="button" onClick={() => { setSide('sell'); setAmount(''); setErr(null) }}
                className={side === 'sell' ? 'tab-active' : 'tab-inactive'}>
                לצאת מהתחזית
              </button>
            </div>
          )}

          {side === 'buy' ? (
            <div className="flex flex-col gap-2">
              <span className="flex items-center justify-between text-[13px] font-bold text-fg-strong">
                <span>כמה סטופרים?</span>
                <span className="flex items-center gap-1.5 text-fg-muted font-normal">
                  <MoreCoin size={20} /> יש לך <span className="fl-num">{fmtCoins(balance)}</span>
                </span>
              </span>
              <div className="flex items-center justify-between h-16 rounded-2xl bg-surface-inset border-2 border-fg-strong px-2">
                <button type="button" aria-label="פחות" onClick={() => setStake(Math.max(0, stake - STEP))}
                  className="w-11 h-11 rounded-full bg-surface-sunken flex items-center justify-center text-fg-strong">
                  <Minus className="w-5 h-5" />
                </button>
                <label className="flex items-center gap-2 min-w-0">
                  <MoreCoin size={30} />
                  <span className="sr-only">כמה סטופרים</span>
                  <input
                    type="number" inputMode="numeric" min="0" step="any" dir="ltr"
                    value={amount} onChange={e => { setAmount(e.target.value); setErr(null); setDone(null) }}
                    placeholder="0"
                    className="w-28 bg-transparent text-center fl-num text-[32px] text-fg-strong focus:outline-none placeholder:text-fg-faint [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </label>
                <button type="button" aria-label="יותר" onClick={() => setStake(Math.min(Number(balance) || 0, stake + STEP))}
                  className="w-11 h-11 rounded-full bg-surface-sunken flex items-center justify-center text-fg-strong">
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="flex gap-2">
                {QUICK.map(v => (
                  <button key={v} type="button" onClick={() => setStake(v)} disabled={v > Number(balance)}
                    className={`flex-1 h-11 rounded-full text-sm font-bold fl-num transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      stake === v ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-fg-strong'}`}>
                    {v}
                  </button>
                ))}
                <button type="button" onClick={() => setStake(Math.floor(Number(balance) || 0))} disabled={!(Number(balance) > 0)}
                  className={`flex-1 h-11 rounded-full text-sm font-bold transition-colors disabled:opacity-30 ${
                    stake > 0 && stake === Math.floor(Number(balance)) ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-fg-strong'}`}>
                  הכל
                </button>
              </div>
            </div>
          ) : (
            <label className="block">
              <span className="flex items-center justify-between text-[13px] font-bold text-fg-strong mb-1.5">
                <span>כמה מהתחזית לסגור</span>
                <span className="text-fg-muted font-normal">יש לך <span className="fl-num">{held.toFixed(1)}</span></span>
              </span>
              <input
                type="number" inputMode="decimal" min="0" step="any" dir="ltr"
                value={amount} onChange={e => { setAmount(e.target.value); setErr(null); setDone(null) }}
                placeholder="0"
                className="w-full min-h-[48px] bg-surface-inset border border-line rounded-control px-3 py-2.5 fl-num text-lg text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              <div className="flex gap-2 mt-2">
                {[0.25, 0.5, 1].map(f => (
                  <button key={f} type="button" onClick={() => setAmount(String(+(held * f).toFixed(6)))}
                    className="flex-1 h-11 rounded-full bg-surface-sunken text-fg-strong fl-num text-sm">
                    {f === 1 ? 'הכל' : `${f * 100}%`}
                  </button>
                ))}
              </div>
            </label>
          )}

          {preview && (
            <div className="rounded-2xl bg-surface-page px-3.5 py-3 flex flex-col gap-1.5 text-[13.5px]">
              {side === 'buy' ? (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-fg-strong">{ifLabel(outcome)}</span>
                    <span className="font-extrabold text-pos whitespace-nowrap">ה־<span className="fl-num">{fmtCoins(stake)}</span> גדלים ל־<span className="fl-num">{fmtCoins(preview.payout)}</span></span>
                  </div>
                  <div className="flex justify-between gap-3 text-fg-muted">
                    <span>אם לא</span><span>ה־<span className="fl-num">{fmtCoins(stake)}</span> לא חוזרים</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between gap-3">
                  <span className="text-fg-strong">יוצאים עם</span>
                  <span className="font-extrabold text-fg-strong"><span className="mkt-coin">{fmtCoins(preview.proceeds)}</span> סטופרים</span>
                </div>
              )}
              <div className="flex justify-between gap-3 text-fg-muted text-[12px]">
                <span>האחוזים אחרי התחזית שלך</span>
                <span className="fl-num" dir="ltr">{pct(outcome.price)} → {pct(preview.newPrice)}</span>
              </div>
              <div className="flex justify-between gap-3 text-fg-muted text-[12px]">
                <span>סיכוי ממוצע בתחזית הזו</span>
                <span className="fl-num" dir="ltr">{pct(preview.avg)}</span>
              </div>
            </div>
          )}

          {overBalance && <p className="text-[13px] text-neg">אין לך מספיק סטופרים</p>}
          {overHolding && <p className="text-[13px] text-neg">זה יותר ממה שיש לך בתחזית</p>}
          {err && <p className="text-[13px] text-neg">{err}</p>}
          {done && <p className="text-[13px] text-pos font-bold">{done}</p>}

          <button type="submit"
            disabled={busy || !preview || overBalance || overHolding}
            className="h-14 rounded-2xl bg-brand text-brand-fg text-base font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {side === 'buy'
              ? (preview ? <>לחזות · <span className="fl-num">{fmtCoins(stake)}</span> סטופרים</> : 'לחזות')
              : 'לצאת מהתחזית'}
          </button>
          <span className="self-center text-[12px] text-fg-muted">
            {market.kind === 'game' ? 'אפשר לצאת עד שריקת הפתיחה' : 'אפשר לצאת עד שהשאלה נסגרת'}
          </span>
        </form>
      )}
    </div>
  )
}

/**
 * The moment a prediction lands: a check that pops, a burst of coins, and the one
 * number that matters. Dismisses itself; a tap dismisses it sooner.
 */
function Celebration({ label, stake, payout, onClose }) {
  return (
    <button type="button" onClick={onClose}
      className="absolute inset-0 z-10 bg-surface/95 backdrop-blur-sm flex flex-col items-center justify-center text-center px-6 rounded-[inherit]"
      aria-live="polite">
      <div className="relative mb-3">
        <div className="mkt-burst absolute inset-0" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 36}deg`, animationDelay: `${(i % 3) * 40}ms` }} />
          ))}
        </div>
        <span className="mkt-pop relative w-16 h-16 rounded-full bg-pos flex items-center justify-center shadow-lg">
          <Check className="w-8 h-8 text-white" strokeWidth={3} />
        </span>
      </div>
      <p className="text-lg font-extrabold text-fg-strong">התחזית נכנסה!</p>
      <p className="text-sm text-fg-muted mt-1">
        <span className="mkt-coin">{fmtCoins(stake)}</span> סטופרים על <span className="font-bold text-fg-strong">{label}</span>
      </p>
      <p className="text-[12px] text-fg-muted mt-3">אם צודקים, גדלים ל־</p>
      <p className="mkt-coin text-2xl mkt-pop" style={{ animationDelay: '150ms' }}>{fmtCoins(payout)}</p>
    </button>
  )
}
