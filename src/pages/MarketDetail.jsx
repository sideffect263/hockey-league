import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Lock, Droplets } from "lucide-react"
import { Sparkle as Sparkles, MapPin, BrandIcon } from "@/components/icons/BrandIcons"
import { useAuth } from '@/lib/AuthContext'
import {
  loadBoard, cachedBoard, getTrades, gameSides,
  coins as fmtCoins, pct,
} from '@/lib/market'
import { useSideColors } from '@/components/market/MatchCard'
import MarketGate from '@/components/market/MarketGate'
import { StatusChip, OutcomeFace, closesIn } from '@/components/market/MarketCard'
import TradeTicket from '@/components/market/TradeTicket'
import PriceChart from '@/components/market/PriceChart'
import { TeamBlend, CrestDisc } from '@/components/fl/Floodlight'
import { MoreCoin, MoreSheet } from '@/components/fl/more/MoreKit'
import { MarketDetailSkeleton } from "@/components/skeletons/PageSkeletons"

const TZ = 'Asia/Jerusalem'
const whenLabel = iso => {
  const d = new Date(iso)
  const wd = d.toLocaleDateString('he-IL', { weekday: 'long', timeZone: TZ }).replace('יום ', '')
  const dm = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: TZ })
  const t = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  return `${wd} ${dm} · ${t}`
}

/** Phones get the ticket as a bottom sheet (board PredictSheet); laptops keep it beside the chart. */
function useIsDesktop() {
  const q = '(min-width: 1024px)'
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setD(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return d
}

export default function MarketDetail() {
  // /market/:key — a slug or a UUID from an older link. Resolved off the list the
  // page already loads (public now), rather than through useSlugId.
  const { id: routeKey } = useParams()
  const { user, loading: authLoading } = useAuth()
  const desktop = useIsDesktop()
  const navigate = useNavigate()

  // Opened from the board, everything but the tape is already in this tab's
  // cache — paint it now and refresh underneath rather than skeleton the page.
  const seed = cachedBoard(user?.id)
  const find = ms => (ms || []).find(x => x.slug === routeKey || x.id === routeKey) || null
  const seedMarket = seed ? find(seed.markets) : null

  const [reason, setReason] = useState(seedMarket ? (seed.reason ?? null) : undefined)
  const [market, setMarket] = useState(seedMarket)
  const [wallet, setWallet] = useState(seed?.wallet ?? null)
  const [positions, setPositions] = useState(seed?.positions ?? {})
  const [activity, setActivity] = useState(seedMarket ? (seed.activity?.get(seedMarket.id) ?? null) : null)
  const [trades, setTrades] = useState(null)
  const [conflict, setConflict] = useState(seedMarket ? (seed.conflicts.get(seedMarket.id) ?? null) : null)
  const [missing, setMissing] = useState(false)
  const [sheet, setSheet] = useState(null) // null | { side, outcome }

  // A slug from the cache lets the tape start loading in the first round trip
  // instead of waiting for the board to resolve it.
  useEffect(() => {
    if (!seedMarket) return
    getTrades(seedMarket.id).then(setTrades).catch(() => setTrades([]))
  }, [seedMarket?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadedFor = useRef(null)
  const load = useCallback(async () => {
    const b = await loadBoard()
    // `reason` only decides the side panel now: the ticket, or how to join.
    setReason(b.reason ?? null)
    const m = find(b.markets)
    const ts = m ? await getTrades(m.id).catch(() => []) : []
    setWallet(b.wallet); setPositions(b.positions); setTrades(ts)
    setActivity(m ? (b.activity?.get(m.id) ?? null) : null)
    setConflict(m ? (b.conflicts.get(m.id) ?? null) : null); setMarket(m); setMissing(!m)
  }, [routeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // As on the board: the session's user is enough, the account bootstrap isn't
  // needed. Signed out, the page still loads once auth says there's no session.
  useEffect(() => {
    const who = user ? user.id : (authLoading ? null : 'anon')
    // Once per viewer and market: authLoading flipping later must not reload.
    const k = who && `${who}:${routeKey}`
    if (k && loadedFor.current !== k) { loadedFor.current = k; load() }
  }, [authLoading, user?.id, load]) // eslint-disable-line react-hooks/exhaustive-deps

  if (reason === undefined && !market) {
    return <MarketDetailSkeleton />
  }
  if (missing) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-fg-muted mb-4">התחזית הזו לא נמצאה</p>
        <Link to="/market" className="btn-secondary inline-flex min-h-[44px]">חזרה לסטופר מרקט</Link>
      </div>
    )
  }
  if (!market) {
    return <MarketDetailSkeleton />
  }

  const mine = market.outcomes
    .map(o => ({ o, p: positions[o.id] }))
    .filter(x => Number(x.p?.shares) > 0)
  const canTrade = !reason && !conflict && market.status === 'open'
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/market'))
  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: market.title, url })
      else await navigator.clipboard?.writeText(url)
    } catch { /* closed the share sheet */ }
  }

  const ticket = (opts = {}) => (
    <TradeTicket market={market} balance={wallet?.balance ?? 0} position={positions}
      onTraded={load} {...opts} />
  )
  const sidePanel = reason ? (
    <MarketGate compact reason={reason} onUnlocked={load} />
  ) : conflict ? (
    <div className="fl-card p-6 text-center">
      <Lock className="w-6 h-6 text-fg-muted mx-auto mb-3" />
      <p className="text-sm font-bold text-fg-strong mb-1">כאן אפשר רק לצפות</p>
      <p className="text-[13px] text-fg-muted leading-relaxed">
        {conflict === 'referee'
          ? 'אי אפשר לחזות על משחק שאתה משובץ לשפוט.'
          : 'אי אפשר לחזות על משחק שהקבוצה שלך משחקת בו.'}
      </p>
    </div>
  ) : null

  const fresh = trades && trades.length === 0 && market.status === 'open'
    && market.outcomes.every(o => Math.abs(o.price - 1 / market.outcomes.length) < 0.001)

  return (
    <div className={`fl-mkt ${canTrade ? 'pb-28 lg:pb-8' : 'pb-8'}`}>
      <Hero market={market} onBack={back} onShare={share} />

      <div className="max-w-6xl mx-auto px-3 sm:px-6 mt-3.5 grid lg:grid-cols-[minmax(0,1fr)_380px] gap-3.5 lg:gap-6 items-start">
        <div className="space-y-3 min-w-0">
          {/* Mobile: why this viewer can't predict sits right under the hero. */}
          {!desktop && sidePanel}

          <section aria-label="מה הליגה חושבת" className="fl-card p-3.5">
            {market.kind === 'game' && <OutcomeTiles market={market} />}
            <div className={`flex justify-between gap-3 text-[12px] text-fg-muted ${market.kind === 'game' ? 'mt-3.5' : ''} mb-1.5`}>
              <span>מאז הפתיחה</span>
              {activity && (activity.traders > 0) && (
                <span><span className="fl-num">{activity.traders}</span> משתתפים · <span className="fl-num">{fmtCoins(activity.volume)}</span> סטופרים בפנים</span>
              )}
            </div>
            {/* "Nobody has predicted" only when the book agrees — every price still at the
                1/n it opened on. A tape that failed to load must not claim it. */}
            {fresh ? (
              <div className="py-6 text-center">
                <Sparkles className="w-7 h-7 mx-auto mb-2" />
                <p className="font-extrabold text-fg-strong">עוד אף אחד לא חזה כאן</p>
                <p className="text-[13px] text-fg-muted mt-1 max-w-xs mx-auto leading-relaxed">
                  כל האפשרויות עדיין באחוזי הפתיחה. התחזית הראשונה קובעת את הקו,
                  ומי שנכנס ראשון מקבל את האחוזים הכי טובים.
                </p>
              </div>
            ) : (
              <PriceChart market={market} trades={trades} variant="hero" />
            )}
          </section>

          {mine.length > 0 && (
            <MyPosition market={market} mine={mine}
              onExit={canTrade ? (o) => (desktop ? null : setSheet({ side: 'sell', outcome: o.id })) : null}
              desktop={desktop} />
          )}

          <section aria-label="איך זה עובד" className="fl-card px-3.5 py-3.5 text-[13px] leading-relaxed text-fg-soft">
            האחוזים זזים לפי מה שכולם חוזים. כשנכנסים מוקדם על מה שאחרים לא רואים, הסטופרים גדלים יותר אם צודקים.
            {market.kind === 'game' ? ' אפשר לצאת לפני שריקת הפתיחה.' : ' אפשר לצאת עד שהשאלה נסגרת.'} אין כסף אמיתי.
          </section>

          <div className="flex items-center gap-4 flex-wrap text-[12px] text-fg-muted px-1.5">
            {market.game?.venue && (
              <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{market.game.venue}</span>
            )}
            {market.status === 'open' && closesIn(market.closes_at) && (
              <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />נסגר {closesIn(market.closes_at)}</span>
            )}
            <span className="flex items-center gap-1.5" title="נזילות: ככל שהיא גבוהה יותר, תחזית בודדת מזיזה פחות את האחוזים">
              <Droplets className="w-3.5 h-3.5" />נזילות <span className="fl-num">{fmtCoins(market.b)}</span>
            </span>
          </div>

          {market.resolution_note && (
            <p className="fl-card px-4 py-3 text-[13px] text-fg-muted">{market.resolution_note}</p>
          )}

          {/* Who predicted what is for signed-in viewers; signed out, the rows
              carry no identities and only feed the chart. */}
          {user && <Tape trades={(trades || []).filter(t => !t.anonymous)} market={market} />}
        </div>

        {desktop && (
          <div className="lg:sticky lg:top-20">
            {sidePanel || ticket()}
          </div>
        )}
      </div>

      {/* Phone: the board's sticky "לחזות" bar, above the tab bar. */}
      {!desktop && canTrade && (
        <div className="lg:hidden fixed inset-x-0 z-30 bottom-[calc(76px+env(safe-area-inset-bottom))] px-3 pt-2.5 pb-2.5 bg-surface/95 backdrop-blur border-t border-line-header">
          <button type="button" onClick={() => setSheet({ side: 'buy', outcome: null })}
            className="w-full max-w-lg mx-auto h-[54px] rounded-2xl bg-brand text-brand-fg flex items-center justify-center gap-2.5 text-base font-extrabold">
            <MoreCoin size={26} /> לחזות
          </button>
        </div>
      )}
      {!desktop && (
        <MoreSheet open={!!sheet} onClose={() => setSheet(null)} label="לחזות">
          <div className="flex items-center justify-between gap-3 mb-3.5">
            <h2 className="text-[22px] font-extrabold text-fg-strong leading-tight">
              {market.kind === 'game' ? (market.subtitle || 'מי תנצח?') : market.title}
            </h2>
          </div>
          {sheet && ticket({ bare: true, initialSide: sheet.side, initialOutcome: sheet.outcome })}
        </MoreSheet>
      )}
    </div>
  )
}

/** Board PredictDetail hero: the two-team blend for a game, night ink for a season question. */
function Hero({ market, onBack, onShare }) {
  const { home, away } = market.kind === 'game' ? gameSides(market) : {}
  const top = (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onBack} aria-label="חזרה"
        className="w-11 h-11 rounded-full bg-[rgba(8,12,18,.35)] flex items-center justify-center text-white">
        <ArrowRight className="w-5 h-5" />
      </button>
      <span className="text-[12.5px] font-bold px-3 py-1.5 rounded-full bg-[rgba(8,12,18,.35)] text-white">
        {market.status === 'open'
          ? (closesIn(market.closes_at) ? `נסגר ${closesIn(market.closes_at)}` : 'פתוח')
          : market.status === 'closed' ? 'סגור לתחזיות' : market.status === 'resolved' ? 'הוכרע' : 'בוטל'}
      </span>
      <button type="button" onClick={onShare} aria-label="שיתוף"
        className="w-11 h-11 rounded-full bg-[rgba(8,12,18,.35)] flex items-center justify-center">
        <BrandIcon name="share" variant="large" className="w-[26px] h-[26px]" />
      </button>
    </div>
  )

  if (home && away) {
    return (
      <TeamBlend home={home.team} away={away.team} className="px-4 pt-4 pb-6 rounded-b-[28px] lg:w-[calc(100%-3rem)] lg:max-w-[1104px] lg:mx-auto lg:mt-4 lg:rounded-[28px]">
        {top}
        <div className="flex items-center justify-between mt-5 max-w-xl mx-auto">
          <Link to={home.team?.id ? `/teams/${home.team.id}` : '#'} className="flex flex-col items-center gap-1.5 w-[110px] text-white">
            <CrestDisc team={home.team} size={64} />
            <span className="text-sm font-extrabold text-center leading-tight">{home.label}</span>
          </Link>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-[20px] font-extrabold">{market.title?.includes('?') ? market.title : 'מי תנצח?'}</h1>
            {market.game?.game_date && <span className="text-[12.5px] opacity-85">{whenLabel(market.game.game_date)}</span>}
          </div>
          <Link to={away.team?.id ? `/teams/${away.team.id}` : '#'} className="flex flex-col items-center gap-1.5 w-[110px] text-white">
            <CrestDisc team={away.team} size={64} />
            <span className="text-sm font-extrabold text-center leading-tight">{away.label}</span>
          </Link>
        </div>
      </TeamBlend>
    )
  }

  return (
    <section className="relative px-4 pt-4 pb-6 rounded-b-[28px] bg-fl-night text-white lg:w-[calc(100%-3rem)] lg:max-w-[1104px] lg:mx-auto lg:mt-4 lg:rounded-[28px]">
      {top}
      <div className="flex items-center gap-3 mt-5 max-w-2xl">
        <BrandIcon name={market.outcomes.some(o => o.player) ? 'goal' : 'trophy'} variant="large" className="w-14 h-14 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[26px] font-extrabold leading-tight">{market.title}</h1>
          {market.subtitle && <p className="text-[13px] opacity-80 mt-1">{market.subtitle}</p>}
        </div>
      </div>
    </section>
  )
}

/** Three outcome tiles: big %, the name, the move since the market opened. */
function OutcomeTiles({ market }) {
  const { home, draw, away } = gameSides(market)
  const colors = useSideColors(home, away)
  if (!home || !away) return null
  const n = market.outcomes.length
  const tile = (o, label, c) => {
    if (!o) return null
    const d = Math.round((o.price - 1 / n) * 100)
    return (
      <div key={o.id} className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-control bg-surface-page text-center min-w-0">
        <span className="fl-num text-[30px]" style={{ color: c || undefined }}>{pct(o.price)}</span>
        <span className="text-[12.5px] font-bold text-fg-strong max-w-full truncate">{label}</span>
        <span className={`text-[11.5px] font-bold ${d > 0 ? 'text-pos' : d < 0 ? 'text-neg' : 'text-fg-muted'}`}>
          {d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '—'}
        </span>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {tile(home, home.label, colors.home)}
      {tile(draw, 'תיקו', null)}
      {tile(away, away.label, colors.away)}
    </div>
  )
}

/** Board PredictDetail "התחזית שלך": the dark card, one row per outcome held. */
function MyPosition({ market, mine, onExit, desktop }) {
  return (
    <section aria-label="התחזית שלך" className="rounded-card p-3.5 bg-[#11161D] text-white flex flex-col gap-2.5 dark:bg-surface dark:ring-1 dark:ring-line">
      {mine.map(({ o, p }) => {
        const shares = Number(p.shares)
        const cost = Number(p.cost_basis)
        // Once settled the position is history, so show what it actually
        // returned: a correct share paid 1 coin, a wrong one 0, and a void
        // refunded the stake.
        const settledValue =
          market.status === 'void' ? cost
          : market.status === 'resolved'
            ? (o.id === market.resolved_outcome_id ? shares : 0)
            : null
        const value = settledValue ?? shares * o.price
        const pnl = value - cost
        return (
          <div key={o.id} className="flex flex-col gap-2.5 [&+&]:border-t [&+&]:border-white/10 [&+&]:pt-2.5">
            <div className="flex items-center gap-2.5">
              <MoreCoin size={40} />
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-[12.5px] opacity-75">התחזית שלך</span>
                <span className="text-base font-extrabold truncate">{o.label} · <span className="fl-num">{fmtCoins(Math.round(cost))}</span> סטופרים</span>
              </div>
              {settledValue == null ? (
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className="text-[12px] opacity-75">אם צודקים, גדלים ל־</span>
                  <span className="fl-num text-[22px] text-[#F2B233]">{fmtCoins(Math.round(shares))}</span>
                </div>
              ) : (
                <span className={`fl-num text-[22px] shrink-0 ${pnl >= 0 ? 'text-[#7EE2A0]' : 'text-[#FF8A80]'}`} dir="ltr">
                  {pnl >= 0 ? '+' : '−'}{fmtCoins(Math.abs(Math.round(pnl)))}
                </span>
              )}
            </div>
            {settledValue == null && (
              <div className="flex justify-between items-center gap-3 text-[12.5px] border-t border-white/10 pt-2.5">
                <span className="opacity-80">
                  שווה עכשיו <span className="fl-num">{fmtCoins(Math.round(value))}</span>
                  {Math.round(pnl) !== 0 && (pnl < 0 ? ' (האחוזים ירדו מאז)' : ' (האחוזים עלו מאז)')}
                </span>
                {onExit && !desktop && (
                  <button type="button" onClick={() => onExit(o)} className="min-h-[44px] font-bold underline underline-offset-4">לצאת מהתחזית</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

/** Recent predictions, with names — signed-in viewers only. */
function Tape({ trades, market }) {
  if (!trades.length) return null
  const label = id => market.outcomes.find(o => o.id === id)?.label || '—'
  return (
    <section aria-label="תחזיות אחרונות" className="fl-card overflow-hidden">
      <h2 className="text-[17px] font-extrabold text-fg-strong px-4 py-3 border-b border-line">תחזיות אחרונות</h2>
      <ul className="divide-y divide-line max-h-80 overflow-y-auto">
        {trades.map(t => (
          <li key={t.id} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px]">
            <span className={`stat-pill text-[11px] px-2 py-0.5 ${
              t.side === 'buy' ? 'bg-pos/10 text-pos' : 'bg-surface-sunken text-fg-muted'
            }`}>{t.side === 'buy' ? 'חזה' : 'יצא'}</span>
            <span className="font-semibold text-fg-strong truncate">{t.trader?.display_name || 'שחקן'}</span>
            <span className="text-fg-muted truncate">{label(t.outcome_id)}</span>
            <span className="ms-auto mkt-coin text-[12px] shrink-0">{fmtCoins(t.coins)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

