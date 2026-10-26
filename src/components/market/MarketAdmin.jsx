import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { Loader2, Plus, Minus, RefreshCw, Gavel, Ban, Lock, Unlock, Users, ListChecks, AlertTriangle, Check, Trash2, Droplets, Search, X } from 'lucide-react'
import { CalendarClock } from "@/components/icons/BrandIcons"
import {
  getTraders, adjustCoins, resolveMarket, voidMarket, setMarketStatus, setMarketCloses,
  syncGameMarkets, createFutures, addOutcome, removeOutcome, setLiquidity,
  getTradedMarketIds, coins as fmtCoins, pct, START_BALANCE,
} from '@/lib/market'
import { getPlayers, getTeams } from '@/lib/api'

/**
 * Manager dashboard, living inside the market rather than in /admin — everything
 * here is about this one system, and the people running it are already standing
 * in it.
 *
 * Settling and voiding both move coins irreversibly across every wallet in the
 * league, so neither is a single click: each opens an explicit confirm step that
 * names what is about to happen.
 */
export default function MarketAdmin({ markets, onChanged }) {
  const [tab, setTab] = useState('traders')
  return (
    <div>
      <div className="flex gap-1.5 mb-4">
        <Pill active={tab === 'traders'} onClick={() => setTab('traders')} icon={Users}>מהמרים</Pill>
        <Pill active={tab === 'markets'} onClick={() => setTab('markets')} icon={ListChecks}>שווקים</Pill>
      </div>
      {tab === 'traders' ? <Traders /> : <Markets markets={markets} onChanged={onChanged} />}
    </div>
  )
}

function Pill({ active, onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
        active ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-fg-muted hover:text-fg-soft'
      }`}>
      <Icon className="w-3.5 h-3.5" />{children}
    </button>
  )
}

// ── Traders ─────────────────────────────────────────────────────────────────

function Traders() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [openFor, setOpenFor] = useState(null)

  const load = useCallback(() => {
    getTraders().then(setRows).catch(e => setErr(e.message))
  }, [])
  useEffect(load, [load])

  if (err) return <p className="text-sm text-neg py-6 text-center">{err}</p>
  if (!rows) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-brand" /></div>
  if (!rows.length) return <p className="text-sm text-fg-muted py-10 text-center">עדיין אין מהמרים</p>

  const supply = rows.reduce((a, r) => a + Number(r.total), 0)
  const granted = rows.reduce((a, r) => a + Number(r.granted), 0)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="מהמרים" value={rows.length} />
        <Stat label="סך המטבעות במחזור" value={fmtCoins(supply)} />
        <Stat label="מתוכם הוענקו ידנית" value={fmtCoins(granted)} />
      </div>

      <div className="mkt-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-fg-subtle border-b border-line-subtle">
                <th className="text-start font-semibold px-4 py-2">שחקן</th>
                <th className="text-end font-semibold px-2 py-2">מטבעות</th>
                <th className="text-end font-semibold px-2 py-2 hidden sm:table-cell">פוזיציות</th>
                <th className="text-end font-semibold px-2 py-2">שווי תיק</th>
                <th className="text-end font-semibold px-2 py-2 hidden md:table-cell">עסקאות</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map(r => (
                // Keyed Fragment, not a bare <> — the row and its expanded
                // adjust panel are two siblings that must reconcile as one item.
                <Fragment key={r.user_id}>
                  <tr>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-fg-strong truncate">{r.display_name}</p>
                      {r.player_name && <p className="text-[11px] text-fg-subtle truncate">{r.player_name}</p>}
                    </td>
                    <td className="px-2 py-2.5 text-end mkt-num text-fg-soft">{fmtCoins(r.balance)}</td>
                    <td className="px-2 py-2.5 text-end mkt-num text-fg-muted hidden sm:table-cell">{fmtCoins(r.open_value)}</td>
                    <td className={`px-2 py-2.5 text-end mkt-num font-bold ${
                      Number(r.total) >= START_BALANCE ? 'text-pos' : 'text-neg'}`}>{fmtCoins(r.total)}</td>
                    <td className="px-2 py-2.5 text-end mkt-num text-fg-muted hidden md:table-cell">{r.trades}</td>
                    <td className="px-4 py-2.5 text-end">
                      <button onClick={() => setOpenFor(openFor === r.user_id ? null : r.user_id)}
                        className="text-[11px] font-bold text-brand hover:underline">מטבעות</button>
                    </td>
                  </tr>
                  {openFor === r.user_id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-surface-inset">
                        <AdjustForm trader={r} onDone={() => { setOpenFor(null); load() }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="mkt-card px-3 py-2.5">
      <p className="text-[10px] text-fg-subtle font-semibold">{label}</p>
      <p className="mkt-num font-black text-lg text-fg-strong">{value}</p>
    </div>
  )
}

function AdjustForm({ trader, onDone }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const run = async (sign) => {
    const n = Number(amount)
    if (!(n > 0)) { setErr('צריך סכום חיובי'); return }
    setBusy(true); setErr(null)
    try {
      await adjustCoins(trader.user_id, sign * n, reason.trim() || null)
      onDone()
    } catch (e) { setErr(e.message || 'הפעולה נכשלה') } finally { setBusy(false) }
  }

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="block">
        <span className="text-[10px] text-fg-subtle font-semibold block mb-1">סכום</span>
        <input type="number" min="0" step="1" dir="ltr" value={amount} onChange={e => setAmount(e.target.value)}
          className="w-28 bg-surface border border-line rounded-lg px-2.5 py-1.5 mkt-num text-sm text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30" />
      </label>
      <label className="block flex-1 min-w-[140px]">
        <span className="text-[10px] text-fg-subtle font-semibold block mb-1">סיבה (רשות)</span>
        <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="בונוס שבועי"
          className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-sm text-fg-soft focus:outline-none focus:ring-2 focus:ring-brand/30" />
      </label>
      <button onClick={() => run(1)} disabled={busy}
        className="btn btn-sm bg-pos text-white hover:opacity-90 disabled:opacity-40">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} הוספה
      </button>
      <button onClick={() => run(-1)} disabled={busy}
        className="btn btn-sm bg-neg text-white hover:opacity-90 disabled:opacity-40">
        <Minus className="w-3.5 h-3.5" /> הפחתה
      </button>
      {err && <p className="text-[11px] text-neg w-full">{err}</p>}
    </div>
  )
}

// ── Markets ─────────────────────────────────────────────────────────────────

function Markets({ markets, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [creating, setCreating] = useState(false)
  const [traded, setTraded] = useState(() => new Set())

  // Which markets are frozen. Re-read on every change, because the answer flips
  // the moment somebody's first coin lands on a market being built.
  useEffect(() => { getTradedMarketIds().then(setTraded) }, [markets])

  const sync = async () => {
    setBusy(true); setMsg(null)
    try {
      const n = await syncGameMarkets()
      setMsg(n > 0 ? `נפתחו ${n} שווקים חדשים` : 'כל המשחקים העתידיים כבר מכוסים')
      await onChanged?.()
    } catch (e) { setMsg(e.message || 'הפעולה נכשלה') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={sync} disabled={busy} className="btn-secondary btn-sm">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          סנכרון שווקי משחקים
        </button>
        <button onClick={() => setCreating(v => !v)} className="btn-secondary btn-sm">
          <Plus className="w-3.5 h-3.5" /> שוק עונה חדש
        </button>
        {msg && <span className="text-[11px] text-fg-muted">{msg}</span>}
      </div>
      <p className="text-[11px] text-fg-subtle leading-relaxed">
        שווקי משחקים נפתחים ונסגרים אוטומטית לפי לוח המשחקים, ומוכרעים לבד לפי התוצאה
        הסופית. שווקי עונה נבנים ומוכרעים ידנית כאן.
      </p>
      {creating && (
        <NewFuturesForm onDone={async () => { setCreating(false); await onChanged?.() }} />
      )}
      {markets.map(m => (
        <MarketRow key={m.id} market={m} traded={traded.has(m.id)} onChanged={onChanged} />
      ))}
    </div>
  )
}

/**
 * Opens a season market. It is created empty on purpose — the options are added
 * in the row below, where the field can be reviewed as it is built, and the
 * market is worth nothing until it has at least two.
 */
function NewFuturesForm({ onDone }) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [closes, setCloses] = useState('')
  const [b, setB] = useState('1000')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const create = async () => {
    if (!title.trim()) { setErr('צריך שאלה לשוק'); return }
    setBusy(true); setErr(null)
    try {
      const when = closes ? new Date(closes) : null
      await createFutures({
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        closesAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
        b: Number(b) > 0 ? Number(b) : 1000,
      })
      await onDone?.()
    } catch (e) { setErr(e.message || 'הפעולה נכשלה') } finally { setBusy(false) }
  }

  return (
    <div className="mkt-card p-3.5 space-y-2.5">
      <p className="font-bold text-sm text-fg-strong">שוק עונה חדש</p>
      <label className="block">
        <span className="text-[10px] text-fg-subtle font-semibold block mb-1">השאלה</span>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="מלך השערים 2027-28"
          className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-sm text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30" />
      </label>
      <label className="block">
        <span className="text-[10px] text-fg-subtle font-semibold block mb-1">שורת הסבר (רשות)</span>
        <input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="מי יסיים כמלך השערים של העונה?"
          className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-sm text-fg-soft focus:outline-none focus:ring-2 focus:ring-brand/30" />
      </label>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="block">
          <span className="text-[10px] text-fg-subtle font-semibold block mb-1">מועד סגירה (רשות)</span>
          <input type="datetime-local" dir="ltr" value={closes} onChange={e => setCloses(e.target.value)}
            className="bg-surface border border-line rounded-lg px-2.5 py-1.5 mkt-num text-sm text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </label>
        <label className="block">
          <span className="text-[10px] text-fg-subtle font-semibold block mb-1">נזילות</span>
          <input type="number" min="1" step="100" dir="ltr" value={b} onChange={e => setB(e.target.value)}
            className="w-28 bg-surface border border-line rounded-lg px-2.5 py-1.5 mkt-num text-sm text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </label>
        <button onClick={create} disabled={busy} className="btn btn-sm bg-brand text-brand-fg disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} יצירה
        </button>
      </div>
      <p className="text-[11px] text-fg-subtle leading-relaxed">
        נזילות גבוהה = הימור בודד מזיז פחות את המחיר. 700–1000 מתאים לשוק של עד כ-20
        אפשרויות; לשוק שכולל את כל שחקני הליגה השתמשו ב-2000. אפשר לשנות אותה כל עוד
        לא בוצעה עסקה.
      </p>
      {err && <p className="text-[11px] text-neg">{err}</p>}
    </div>
  )
}

/**
 * A UTC instant as the "YYYY-MM-DDTHH:mm" a datetime-local input expects — in
 * the browser's own zone, which is the zone the manager is thinking in.
 * toISOString() would hand back UTC and quietly shift the field by three hours.
 */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A deadline, pinned LTR: bidi otherwise swaps the date and the time around. */
function Deadline({ iso }) {
  return (
    <span dir="ltr" className="mkt-num">
      {new Date(iso).toLocaleString('he-IL', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })}
    </span>
  )
}

function MarketRow({ market, traded, onChanged }) {
  const [mode, setMode] = useState(null) // 'resolve' | 'void' | 'deadline' | 'outcomes'
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const settled = market.status === 'resolved' || market.status === 'void'
  const winner = market.outcomes.find(o => o.id === market.resolved_outcome_id)

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { await fn(); setMode(null); await onChanged?.() }
    catch (e) { setErr(e.message || 'הפעולה נכשלה') } finally { setBusy(false) }
  }

  return (
    <div className="mkt-card p-3.5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-bold text-sm text-fg-strong truncate">{market.title}</p>
          <p className="text-[11px] text-fg-subtle">
            {market.kind === 'game' ? 'שוק משחק' : 'שוק עונה'} · {market.outcomes.length} אפשרויות ·
            נזילות <span className="mkt-num">{fmtCoins(market.b)}</span>
            {market.closes_at
              ? <> · נסגר <Deadline iso={market.closes_at} /></>
              : market.kind !== 'game' && <> · ללא מועד סגירה</>}
            {winner && <> · זכה: <span className="text-brand font-semibold">{winner.label}</span></>}
          </p>
        </div>
        <span className={`stat-pill text-[10px] shrink-0 ${
          market.status === 'open' ? 'bg-pos/10 text-pos'
          : market.status === 'resolved' ? 'bg-brand/10 text-brand'
          : 'bg-surface-sunken text-fg-muted'}`}>{
          { open: 'פתוח', closed: 'סגור', resolved: 'הוכרע', void: 'בוטל' }[market.status]
        }</span>
      </div>

      {!settled && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {market.status === 'open' ? (
            <button onClick={() => run(() => setMarketStatus(market.id, 'closed'))} disabled={busy}
              className="btn-secondary btn-sm"><Lock className="w-3 h-3" /> סגירה</button>
          ) : (
            <button onClick={() => run(() => setMarketStatus(market.id, 'open'))} disabled={busy}
              className="btn-secondary btn-sm"><Unlock className="w-3 h-3" /> פתיחה</button>
          )}
          {/* Only a custom market's deadline is the manager's to set — a game
              market's is its fixture's date, rewritten on every reschedule. */}
          {market.kind !== 'game' && (
            <button onClick={() => { setMode(mode === 'deadline' ? null : 'deadline'); setErr(null) }}
              className="btn-secondary btn-sm"><CalendarClock className="w-3 h-3" /> מועד סגירה</button>
          )}
          {/* A game market's three options are generated from the fixture, so
              there is nothing here to edit — only season markets are built by hand. */}
          {market.kind !== 'game' && (
            <button onClick={() => { setMode(mode === 'outcomes' ? null : 'outcomes'); setErr(null) }}
              className="btn-secondary btn-sm"><ListChecks className="w-3 h-3" /> אפשרויות</button>
          )}
          <button onClick={() => { setMode(mode === 'resolve' ? null : 'resolve'); setErr(null) }}
            className="btn-secondary btn-sm"><Gavel className="w-3 h-3" /> הכרעה</button>
          <button onClick={() => { setMode(mode === 'void' ? null : 'void'); setErr(null) }}
            className="btn-secondary btn-sm"><Ban className="w-3 h-3" /> ביטול</button>
        </div>
      )}

      {mode === 'deadline' && (
        <div className="mt-3 pt-3 border-t border-line-subtle">
          <DeadlineForm market={market} onChanged={onChanged} />
        </div>
      )}

      {mode === 'outcomes' && (
        <div className="mt-3 pt-3 border-t border-line-subtle">
          <OutcomesEditor market={market} traded={traded} onChanged={onChanged} />
        </div>
      )}

      {mode === 'resolve' && (
        <div className="mt-3 pt-3 border-t border-line-subtle">
          <p className="flex items-start gap-1.5 text-[11px] text-fg-muted mb-2 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 text-gold shrink-0 mt-px" />
            הכרעה משלמת מיד לכל המחזיקים באפשרות שנבחרה, מטבע לכל מניה. אי אפשר לבטל.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={pick} onChange={e => setPick(e.target.value)}
              className="filter-select flex-1 min-w-[160px] text-xs py-1.5">
              <option value="">בחר את התוצאה שקרתה…</option>
              {[...market.outcomes].sort((a, b) => b.price - a.price).map(o => (
                <option key={o.id} value={o.id}>{o.label} · {pct(o.price)}</option>
              ))}
            </select>
            <button disabled={!pick || busy}
              onClick={() => run(() => resolveMarket(market.id, pick, 'הוכרע ידנית'))}
              className="btn btn-sm bg-brand text-brand-fg disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gavel className="w-3.5 h-3.5" />}
              אישור הכרעה
            </button>
          </div>
        </div>
      )}

      {mode === 'void' && (
        <div className="mt-3 pt-3 border-t border-line-subtle">
          <p className="flex items-start gap-1.5 text-[11px] text-fg-muted mb-2 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 text-gold shrink-0 mt-px" />
            ביטול מחזיר לכל מהמר בדיוק את מה שהשקיע בשוק הזה, כולל קיזוז רווחים שכבר נמשכו.
          </p>
          <button disabled={busy} onClick={() => run(() => voidMarket(market.id, 'בוטל ידנית'))}
            className="btn btn-sm bg-neg text-white disabled:opacity-40">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            אישור ביטול והחזר
          </button>
        </div>
      )}

      {err && <p className="text-[11px] text-neg mt-2">{err}</p>}
    </div>
  )
}

/** What actually happened, in the manager's words. */
function savedNote({ closes_at: closesAt, status }) {
  if (closesAt && new Date(closesAt) <= new Date()) {
    return 'המועד שנבחר כבר עבר, ולכן השוק נסגר למסחר עכשיו.'
  }
  const what = closesAt
    ? 'נשמר. המסחר ייסגר מעצמו במועד החדש.'
    : 'נשמר. אין מועד סגירה — השוק יישאר פתוח עד שתסגרו אותו ידנית.'
  return status === 'closed'
    ? `${what} שימו לב שהשוק סגור למסחר כרגע — לחצו "פתיחה" כדי לפתוח אותו.`
    : what
}

/**
 * Moves the trading deadline of a custom market.
 *
 * The outcome is read back from the server rather than assumed: a date that has
 * already passed closes the market on the spot, and a market that was closed by
 * hand stays closed even when the new date is months out. Both are things the
 * manager needs told — silently saving a date on a market nobody can trade is
 * how a "why is nobody betting" evening starts.
 */
function DeadlineForm({ market, onChanged }) {
  const [value, setValue] = useState(() => toLocalInput(market.closes_at))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(null)

  const picked = value ? new Date(value) : null
  const valid = picked && !Number.isNaN(picked.getTime())

  const save = async (iso) => {
    setBusy(true); setErr(null); setSaved(null)
    try {
      const res = await setMarketCloses(market.id, iso)
      setSaved(res)
      setValue(toLocalInput(res?.closes_at))
      await onChanged?.()
    } catch (e) { setErr(e.message || 'הפעולה נכשלה') } finally { setBusy(false) }
  }

  return (
    <>
      <p className="text-[11px] text-fg-muted mb-2 leading-relaxed">
        מועד הסגירה הוא הרגע שבו המסחר בשוק נעצר. הפוזיציות נשארות פתוחות עד להכרעה.
      </p>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="block">
          <span className="text-[10px] text-fg-subtle font-semibold block mb-1">מועד סגירה</span>
          <input type="datetime-local" dir="ltr" value={value} onChange={e => setValue(e.target.value)}
            className="bg-surface border border-line rounded-lg px-2.5 py-1.5 mkt-num text-sm text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </label>
        <button disabled={!valid || busy} onClick={() => save(picked.toISOString())}
          className="btn btn-sm bg-brand text-brand-fg disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          שמירה
        </button>
        {(market.closes_at || value) && (
          <button disabled={busy} onClick={() => save(null)} className="btn-secondary btn-sm">
            ללא מועד סגירה
          </button>
        )}
      </div>
      {saved && <p className="text-[11px] text-pos mt-2 leading-relaxed">{savedNote(saved)}</p>}
      {err && <p className="text-[11px] text-neg mt-2">{err}</p>}
    </>
  )
}

/**
 * The options a season market can be bet on.
 *
 * Frozen the moment the first coin moves: LMSR prices every outcome against the
 * whole field, so a runner added under an open position silently re-prices shares
 * somebody already paid for. The server refuses it — this panel says so up front
 * instead of letting a manager fill in a form that was never going to be accepted.
 *
 * Picking a player rather than typing their name matters: an outcome that carries
 * a player_id renders with their photo and takes their club's colour on the price
 * chart. A typed label carries neither.
 */
function OutcomesEditor({ market, traded, onChanged }) {
  const [roster, setRoster] = useState(null)
  const [filter, setFilter] = useState('')
  const [pickPlayer, setPickPlayer] = useState('')
  const [pickTeam, setPickTeam] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(null)      // 'add' | 'bulk' | outcome id
  const [bulk, setBulk] = useState(null)      // { done, total }
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([getPlayers('goals', false), getTeams('name', true)])
      .then(([players, teams]) => alive && setRoster({ players: players || [], teams: teams || [] }))
      .catch(() => alive && setRoster({ players: [], teams: [] }))
    return () => { alive = false }
  }, [])

  const takenPlayers = useMemo(
    () => new Set(market.outcomes.map(o => o.player_id).filter(Boolean)),
    [market.outcomes],
  )
  const takenTeams = useMemo(
    () => new Set(market.outcomes.map(o => o.team_id).filter(Boolean)),
    [market.outcomes],
  )

  const playerOptions = useMemo(() => {
    const teamName = Object.fromEntries((roster?.teams || []).map(t => [t.id, t.name]))
    const seen = {}
    const list = (roster?.players || []).map(p => {
      const nm = `${p.first_name || ''} ${p.last_name || ''}`.replace(/\s+/g, ' ').trim()
      seen[nm] = (seen[nm] || 0) + 1
      return { id: p.id, nm, team: teamName[p.team_id] || '' }
    })
    // Two players really are called עידו ריכטר: a name shared by more than one
    // person carries its club, or the list offers the same row twice.
    return list
      .map(p => ({ ...p, label: seen[p.nm] > 1 && p.team ? `${p.nm} (${p.team})` : p.nm }))
      .sort((a, b) => a.label.localeCompare(b.label, 'he'))
  }, [roster])

  const missing = playerOptions.filter(p => !takenPlayers.has(p.id))

  const run = async (key, fn) => {
    setBusy(key); setErr(null)
    try { await fn(); await onChanged?.() }
    catch (e) { setErr(e.message || 'הפעולה נכשלה') }
    finally { setBusy(null); setBulk(null) }
  }

  const addPlayer = () => {
    const p = playerOptions.find(x => x.id === pickPlayer)
    if (!p) return
    return run('add', async () => { await addOutcome(market.id, p.label, null, p.id); setPickPlayer('') })
  }

  const addTeam = () => {
    const t = (roster?.teams || []).find(x => x.id === pickTeam)
    if (!t) return
    return run('add', async () => { await addOutcome(market.id, t.name, t.id, null); setPickTeam('') })
  }

  const addText = () => {
    if (!text.trim()) return
    return run('add', async () => { await addOutcome(market.id, text.trim(), null, null); setText('') })
  }

  // One at a time, deliberately: market_admin_add_outcome derives each ord from
  // the current maximum, and firing 97 of them in parallel would race for it.
  const addEveryone = () => run('bulk', async () => {
    let done = 0
    for (const p of missing) {
      await addOutcome(market.id, p.label, null, p.id)
      setBulk({ done: ++done, total: missing.length })
    }
  })

  const shown = filter.trim()
    ? market.outcomes.filter(o => o.label.includes(filter.trim()))
    : market.outcomes

  if (traded) {
    return (
      <>
        <p className="flex items-start gap-1.5 text-[11px] text-fg-muted leading-relaxed mb-2">
          <Lock className="w-3.5 h-3.5 text-gold shrink-0 mt-px" />
          כבר בוצעו עסקאות בשוק הזה, ולכן רשימת האפשרויות נעולה. הוספה או הסרה של אפשרות
          הייתה משנה את המחיר של מניות שכבר נקנו. כדי לשנות את הרשימה צריך לבטל את השוק
          (כל ההימורים חוזרים) ולפתוח אותו מחדש.
        </p>
        <OutcomeList outcomes={market.outcomes} />
      </>
    )
  }

  return (
    <>
      <p className="text-[11px] text-fg-subtle leading-relaxed mb-2.5">
        אפשר להוסיף ולהסיר אפשרויות כל עוד לא בוצעה עסקה. עדיף לבחור שחקן או קבוצה
        מהרשימה ולא להקליד שם — כך האפשרות מקבלת תמונה וצבע קבוצה.
      </p>

      <div className="space-y-2 mb-3">
        <div className="flex items-end gap-2 flex-wrap">
          <select value={pickPlayer} onChange={e => setPickPlayer(e.target.value)}
            disabled={!roster || !!busy}
            className="filter-select flex-1 min-w-[180px] text-xs py-1.5">
            <option value="">{roster ? `הוספת שחקן (${missing.length} לא ברשימה)…` : 'טוען שחקנים…'}</option>
            {missing.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button onClick={addPlayer} disabled={!pickPlayer || !!busy}
            className="btn btn-sm bg-brand text-brand-fg disabled:opacity-40">
            {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            הוספה
          </button>
          <button onClick={addEveryone} disabled={!missing.length || !!busy} className="btn-secondary btn-sm">
            {busy === 'bulk'
              ? <><Loader2 className="w-3 h-3 animate-spin" /> {bulk ? `${bulk.done}/${bulk.total}` : ''}</>
              : <><Users className="w-3 h-3" /> כל הליגה</>}
          </button>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <select value={pickTeam} onChange={e => setPickTeam(e.target.value)}
            disabled={!roster || !!busy}
            className="filter-select flex-1 min-w-[180px] text-xs py-1.5">
            <option value="">הוספת קבוצה…</option>
            {(roster?.teams || []).filter(t => !takenTeams.has(t.id))
              .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={addTeam} disabled={!pickTeam || !!busy}
            className="btn btn-sm bg-brand text-brand-fg disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> הוספה
          </button>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <input value={text} onChange={e => setText(e.target.value)} disabled={!!busy}
            placeholder="אפשרות חופשית — למשל: אחר — שחקן שאינו ברשימה"
            className="flex-1 min-w-[180px] bg-surface border border-line rounded-lg px-2.5 py-1.5 text-sm text-fg-soft focus:outline-none focus:ring-2 focus:ring-brand/30" />
          <button onClick={addText} disabled={!text.trim() || !!busy}
            className="btn btn-sm bg-brand text-brand-fg disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> הוספה
          </button>
        </div>
      </div>

      <LiquidityForm market={market} onChanged={onChanged} />

      {market.outcomes.length > 10 && (
        <div className="relative my-2.5">
          <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-3.5 h-3.5 text-fg-subtle pointer-events-none" />
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder={`חיפוש בין ${market.outcomes.length} האפשרויות…`}
            className="w-full bg-surface border border-line rounded-lg ps-8 pe-7 py-1.5 text-xs text-fg-soft focus:outline-none focus:ring-2 focus:ring-brand/30" />
          {filter && (
            <button type="button" onClick={() => setFilter('')} aria-label="ניקוי חיפוש"
              className="absolute top-1/2 -translate-y-1/2 end-2 text-fg-subtle hover:text-fg-soft">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <OutcomeList
        outcomes={shown}
        busyId={busy}
        onRemove={o => run(o.id, () => removeOutcome(o.id))}
      />
      {err && <p className="text-[11px] text-neg mt-2">{err}</p>}
    </>
  )
}

function OutcomeList({ outcomes, busyId, onRemove }) {
  if (!outcomes.length) {
    return <p className="text-[11px] text-fg-subtle py-3 text-center">אין אפשרויות להצגה</p>
  }
  return (
    <ul className="max-h-72 overflow-y-auto divide-y divide-line-subtle rounded-lg bg-surface-inset">
      {outcomes.map(o => (
        <li key={o.id} className="flex items-center gap-2 px-3 py-1.5">
          <span className="text-[13px] text-fg-soft truncate flex-1">{o.label}</span>
          <span className="mkt-num text-[11px] text-fg-muted shrink-0">{pct(o.price)}</span>
          {onRemove && (
            <button onClick={() => onRemove(o)} disabled={!!busyId} aria-label={`הסרת ${o.label}`}
              className="text-fg-subtle hover:text-neg disabled:opacity-40 shrink-0">
              {busyId === o.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The depth of the book, editable only before the first trade — changing it
 * afterwards would re-price every open position.
 */
function LiquidityForm({ market, onChanged }) {
  const [b, setB] = useState(() => String(Math.round(Number(market.b))))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    const n = Number(b)
    if (!(n > 0)) { setErr('נזילות חייבת להיות חיובית'); return }
    setBusy(true); setErr(null); setSaved(false)
    try { await setLiquidity(market.id, n); setSaved(true); await onChanged?.() }
    catch (e) { setErr(e.message || 'הפעולה נכשלה') } finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <Droplets className="w-3.5 h-3.5 text-fg-subtle" />
      <span className="text-fg-muted">נזילות</span>
      <input type="number" min="1" step="100" dir="ltr" value={b}
        onChange={e => { setB(e.target.value); setSaved(false) }}
        className="w-24 bg-surface border border-line rounded-lg px-2 py-1 mkt-num text-xs text-fg-strong focus:outline-none focus:ring-2 focus:ring-brand/30" />
      <button onClick={save} disabled={busy || Number(b) === Number(market.b)}
        className="btn-secondary btn-sm disabled:opacity-40">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} שמירה
      </button>
      <span className="text-fg-subtle">
        ככל שהיא גבוהה יותר, הימור בודד מזיז פחות את המחיר. לשוק עם כל שחקני הליגה — 2000.
      </span>
      {saved && <span className="text-pos font-semibold">נשמר</span>}
      {err && <span className="text-neg">{err}</span>}
    </div>
  )
}
