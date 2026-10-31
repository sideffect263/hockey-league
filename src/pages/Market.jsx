import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Lock, Target } from "lucide-react"
import { Wallet, Star, Celebrate as Gift, TrendUp as TrendingUp, TrendDown as TrendingDown, CalendarDays, Approved, Declined } from "@/components/icons/BrandIcons"
import { useAuth } from '@/lib/AuthContext'
import {
  loadBoard, cachedBoard, invalidateBoard, pickFeaturedList, groupByMatchday, holdsAny,
  coins as fmtCoins, pct, START_BALANCE, getLeaderboard,
} from '@/lib/market'
import MarketGate from '@/components/market/MarketGate'
import MarketCard, { OutcomeFace, StatusChip } from '@/components/market/MarketCard'
import MatchCard, { GameRow } from '@/components/market/MatchCard'
import { FeaturedCarousel } from '@/components/market/FeaturedMarket'
import Leaderboard from '@/components/market/Leaderboard'
import MarketAdmin from '@/components/market/MarketAdmin'
import { useSeasonName } from '@/App'
import { MarketSkeleton } from "@/components/skeletons/PageSkeletons"
import { MoreCoin, MorePillTabs, MoreChip, MoreSectionHead, MoreEmpty } from "@/components/fl/more/MoreKit"

/**
 * The market used to repaint the whole site emerald (html.market-theme) while it was
 * open. Floodlight drops that room: the market lives in the league palette, with the
 * סטופר coin gold as its own colour (see components/fl/more/more.css, `.fl-mkt`).
 * Kept as a no-op so nothing that still calls it re-adds the class.
 */
export function useMarketTheme() {}

/** Season markets shown on the "הכל" board before "כל שווקי העונה". */
const SEASON_PREVIEW = 4
/** Matchdays listed on the "הכל" board after the next one. */
const LATER_PREVIEW = 2

export default function Market() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const seasonName = useSeasonName()

  // Painted from the last load in this tab when there is one, so coming back
  // from a market is instant; a fresh load then runs underneath.
  const cached = cachedBoard(user?.id)
  const [board, setBoard] = useState(cached)
  const [tab, setTab] = useState('board')
  const [filter, setFilter] = useState('all')

  const loadedFor = useRef(null)
  const load = useCallback(async () => {
    const b = await loadBoard().catch(() => null)
    if (b) setBoard(b)
  }, [])

  // Keyed on the user alone, not on authLoading: the account bootstrap (admin
  // check, roles, profile) takes seconds and the market needs none of it — the
  // session's user id is known the moment the page mounts. Signed out, the board
  // still loads (it is public); it just waits for auth to say there's no session.
  useEffect(() => {
    const who = user ? user.id : (authLoading ? null : 'anon')
    // Once per viewer: authLoading flipping later must not fire a second load.
    if (who && loadedFor.current !== who) { loadedFor.current = who; load() }
  }, [authLoading, user?.id, load]) // eslint-disable-line react-hooks/exhaustive-deps

  const markets = board?.markets || null
  const positions = board?.positions || {}
  const conflicts = board?.conflicts || new Map()
  const activity = board?.activity || new Map()
  const wallet = board?.wallet

  const openValue = useMemo(() => {
    let v = 0
    for (const m of markets || []) {
      if (m.status !== 'open' && m.status !== 'closed') continue
      for (const o of m.outcomes) {
        const s = Number(positions[o.id]?.shares || 0)
        if (s > 0) v += s * o.price
      }
    }
    return v
  }, [markets, positions])

  const featured = useMemo(
    () => (markets ? pickFeaturedList(markets, activity, conflicts, 3) : []),
    [markets, activity, conflicts],
  )

  if (!board) return <MarketSkeleton />
  // Everyone sees the board. `reason` only says why this viewer can't predict.
  const canPredict = !board.reason

  // A settled market is history, not something to trade, so it moves to its own
  // capped strip at the bottom instead of sitting between live ones.
  const live = markets.filter(m => m.status === 'open' || m.status === 'closed')
  const games = live.filter(m => m.kind === 'game')
  const futures = live.filter(m => m.kind === 'futures')
  const mineCount = live.filter(m => holdsAny(m, positions)).length
  const settledAll = markets
    .filter(m => m.status === 'resolved' || m.status === 'void')
    .sort((a, b) => new Date(b.resolved_at || 0) - new Date(a.resolved_at || 0))
  const settled = settledAll.slice(0, 6)
  const netWorth = Number(wallet?.balance || 0) + openValue
  // First visit: a wallet that never predicted gets the one-line welcome (board
  // PredictHome "new player"); it goes away after the first prediction.
  const isNew = canPredict && !!wallet && Object.keys(positions).length === 0

  // The leaderboard has names, so it needs a signed-in viewer; "mine" needs a
  // wallet, so it needs someone who can predict.
  const TABS = [
    { key: 'board', label: 'פתוחות' },
    ...(canPredict ? [{ key: 'mine', label: 'שלי' }] : []),
    ...(user ? [{ key: 'top', label: 'מובילים' }] : []),
    ...(isAdmin ? [{ key: 'admin', label: 'ניהול' }] : []),
  ]

  return (
    <div className="fl-mkt max-w-6xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-8">
      <header className="flex items-center justify-between gap-3 px-1 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <MoreCoin size={36} />
          <h1 className="text-[28px] sm:text-[32px] font-extrabold leading-tight text-fg-strong truncate">סטופר מרקט</h1>
        </div>
        {canPredict && (
          <button type="button" onClick={() => setTab('mine')}
            aria-label={`היתרה שלי: ${fmtCoins(wallet?.balance ?? 0)} סטופרים`}
            className="h-11 ps-2 pe-3.5 rounded-full bg-[#11161D] text-white inline-flex items-center gap-2 shrink-0 dark:bg-surface dark:ring-1 dark:ring-line">
            <MoreCoin size={28} />
            {wallet
              ? <span className="fl-num text-lg">{fmtCoins(wallet.balance)}</span>
              : <span className="block h-4 w-12 rounded bg-white/20" />}
          </button>
        )}
      </header>

      {TABS.length > 1 && (
        <MorePillTabs label="סטופר מרקט" tabs={TABS} value={tab} onChange={setTab} className="px-1 pt-1 pb-3" />
      )}

      {tab === 'board' && (
        <>
          {isNew && (
            <section aria-label="ברוכים הבאים" className="rounded-card p-4 mb-3 flex gap-3 items-center text-[#11161D]"
              style={{ background: 'linear-gradient(135deg, #F2B233, #E8743B)' }}>
              <MoreCoin size={58} />
              <div className="flex flex-col gap-1">
                <span className="text-[17px] font-extrabold">קיבלת {fmtCoins(START_BALANCE)} סטופרים</span>
                <span className="text-[13px] leading-snug">בוחרים מה יקרה, וכשצודקים הסטופרים גדלים. אין כסף אמיתי, רק כבוד בטבלת המובילים.</span>
              </div>
            </section>
          )}
          {!canPredict && (
            <MarketGate compact reason={board.reason} onUnlocked={() => { invalidateBoard(); loadedFor.current = null; load() }} />
          )}
        </>
      )}

      {/* The allowance is paid on read, so this is the only moment the predictor is
          told it happened — a silent top-up reads as a balance that drifts. */}
      {Number(wallet?.allowance_credited) > 0 && (
        <div className="fl-card px-4 py-3 mb-3 flex items-center gap-2.5">
          <Gift className="w-5 h-5 shrink-0" />
          <p className="text-[13px] text-fg-strong">
            הסטופרים השבועיים נכנסו: <span className="mkt-coin">{fmtCoins(wallet.allowance_credited)}</span> סטופרים
            {Number(wallet.allowance_weeks) > 1 && ` (${wallet.allowance_weeks} שבועות)`}
          </p>
        </div>
      )}

      {tab === 'board' && (
        <Board canPredict={canPredict}
          filter={filter} setFilter={setFilter}
          featured={featured}
          games={games} futures={futures} settled={settled} mineCount={mineCount}
          live={live} positions={positions} conflicts={conflicts} activity={activity}
          seasonName={seasonName}
        />
      )}

      {tab === 'mine' && canPredict && (
        <MyPositions markets={markets} settledAll={settledAll} positions={positions} balance={wallet?.balance ?? 0}
          netWorth={netWorth} openValue={openValue} userId={user?.id} onBrowse={() => setTab('board')} />
      )}
      {tab === 'top' && user && <div className="max-w-2xl mx-auto"><Leaderboard /></div>}
      {tab === 'admin' && isAdmin && <MarketAdmin markets={markets} onChanged={load} />}

      <p className="text-center text-[12px] text-fg-muted mt-10 leading-relaxed max-w-xl mx-auto">
        סטופר מרקט הוא משחק תחזיות. הסטופרים וירטואליים, אין להם שווי כספי, ואי אפשר
        לקנות, למכור או להמיר אותם בכסף אמיתי.
      </p>
    </div>
  )
}

/**
 * The board, with the forty-fixture problem solved by structure rather than by
 * scrolling: the next matchday in full first (board PredictHome "השבת"), then the
 * season questions, then later rounds folded to one line per game. On a laptop the
 * season questions and the settled strip move to a side column.
 */
function Board({
  canPredict, filter, setFilter, featured, games, futures, settled, mineCount,
  live, positions, conflicts, activity, seasonName,
}) {
  const [showAllRounds, setShowAllRounds] = useState(false)
  const rounds = useMemo(() => groupByMatchday(games), [games])
  const seasonTitle = seasonName ? `העונה · ${seasonName}` : 'העונה'

  const FILTERS = [
    { key: 'all', label: 'הכל' },
    { key: 'season', label: 'העונה', n: futures.length },
    { key: 'games', label: 'משחקים', n: games.length },
    ...(canPredict && mineCount ? [{ key: 'mine', label: 'שלי', n: mineCount }] : []),
  ]

  const card = m => <MarketCard key={m.id} market={m} myShares={positions} conflict={conflicts.get(m.id)} activity={activity.get(m.id)} />
  const [next, ...later] = rounds
  const laterShown = filter === 'games' || showAllRounds ? later : later.slice(0, LATER_PREVIEW)
  const hiddenRounds = later.length - laterShown.length

  const seasonList = filter === 'all'
    ? futures.filter(m => !featured.some(f => f.id === m.id)).slice(0, SEASON_PREVIEW)
    : futures
  const seasonBlock = (
    <section aria-label="העונה">
      <MoreSectionHead title={seasonTitle}
        action={filter === 'all' && futures.length > SEASON_PREVIEW
          ? <button type="button" onClick={() => setFilter('season')} className="text-[13px] font-bold text-fg-strong underline underline-offset-4 min-h-[44px] -my-3">כל {futures.length}</button>
          : <span className="text-[12.5px] text-fg-muted">מוכרעות בסוף העונה</span>} />
      {futures.length === 0
        ? <MoreEmpty icon="trophy" text="אין שאלות עונה פתוחות." />
        : <Stack two={filter === 'season'}>{seasonList.map(card)}</Stack>}
    </section>
  )

  const settledBlock = (max = settled.length) => settled.length > 0 && (
    <section aria-label="הוכרעו לאחרונה">
      <MoreSectionHead title="הוכרעו לאחרונה" />
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-3 px-3 snap-x snap-mandatory lg:mx-0 lg:px-0 lg:flex-col lg:overflow-visible">
        {settled.slice(0, max).map(m => (
          <div key={m.id} className="shrink-0 w-[270px] snap-start lg:w-auto">
            <MarketCard market={m} myShares={positions} />
          </div>
        ))}
      </div>
    </section>
  )

  const gamesBlock = games.length === 0 ? (
    <section aria-label="משחקים">
      <MoreSectionHead title="משחקים" />
      <MoreEmpty icon="calendar" text="אין כרגע משחקים פתוחים לתחזיות. תחזית נפתחת אוטומטית לכל משחק חדש בלוח." />
    </section>
  ) : (
    <>
      <section aria-label={next.label}>
        <MoreSectionHead title={next.label} note="נסגרות בשריקת הפתיחה" />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {next.markets.map(m => (
            <MatchCard key={m.id} market={m} positions={positions}
              conflict={conflicts.get(m.id)} activity={activity.get(m.id)} />
          ))}
        </div>
      </section>

      {laterShown.length > 0 && (
        <section aria-label="בהמשך העונה">
          <MoreSectionHead title="בהמשך העונה" note={`${later.reduce((n, r) => n + r.markets.length, 0)} משחקים`} />
          <div className="space-y-2.5">
            {laterShown.map(r => (
              <div key={r.key} className="mkt-card overflow-hidden">
                <div className="px-3 py-2 bg-surface-inset flex items-center gap-2">
                  <span className="text-[13px] font-extrabold text-fg-strong">{r.label}</span>
                  <span className="text-[12px] text-fg-muted"><span className="fl-num">{r.markets.length}</span> משחקים</span>
                  <span className="ms-auto flex gap-1 text-[11px] text-fg-muted font-semibold">
                    <span className="w-9 sm:w-10 text-center">בית</span>
                    <span className="w-9 sm:w-10 text-center">תיקו</span>
                    <span className="w-9 sm:w-10 text-center">חוץ</span>
                  </span>
                </div>
                <div className="divide-y divide-line">
                  {r.markets.map(m => (
                    <GameRow key={m.id} market={m} positions={positions} conflict={conflicts.get(m.id)} />
                  ))}
                </div>
              </div>
            ))}
            {hiddenRounds > 0 && (
              <button type="button" onClick={() => setShowAllRounds(true)}
                className="w-full mkt-card min-h-[48px] text-[13px] font-bold text-fg-strong hover:bg-surface-inset transition-colors inline-flex items-center justify-center gap-1.5">
                <ChevronDown className="w-4 h-4" />
                עוד {hiddenRounds} מחזורים (<span className="fl-num">{later.slice(LATER_PREVIEW).reduce((n, r) => n + r.markets.length, 0)}</span> משחקים)
              </button>
            )}
          </div>
        </section>
      )}
    </>
  )

  return (
    <div>
      <div className="sticky top-16 z-20 -mx-3 px-3 sm:-mx-6 sm:px-6 py-2 mb-3 bg-surface-page/90 backdrop-blur">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {FILTERS.map(f => (
            <MoreChip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)} n={f.n}>{f.label}</MoreChip>
          ))}
        </div>
      </div>

      {filter === 'all' && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 lg:items-start">
          <div className="space-y-6 min-w-0">
            {featured.length > 0 && <FeaturedCarousel markets={featured} activity={activity} />}
            {gamesBlock}
            <div className="lg:hidden space-y-6">{seasonBlock}</div>
            <div className="lg:hidden">{settledBlock()}</div>
          </div>
          <aside className="hidden lg:block space-y-6">
            {seasonBlock}
            {/* Beside the board, the last three are enough; the phone strip scrolls. */}
            {settledBlock(3)}
          </aside>
        </div>
      )}

      {filter === 'season' && seasonBlock}
      {filter === 'games' && <div className="space-y-6">{gamesBlock}</div>}

      {filter === 'mine' && (
        <section aria-label="התחזיות שלי">
          <MoreSectionHead title="התחזיות שלי" note={`${mineCount}`} />
          <Stack two>{live.filter(m => holdsAny(m, positions)).map(card)}</Stack>
        </section>
      )}
    </div>
  )
}

function Stack({ children, two = false }) {
  return <div className={`grid gap-2.5 ${two ? 'sm:grid-cols-2' : ''}`}>{children}</div>
}

const WEEK = 7 * 86400000

/**
 * "שלי" (board PredictMine): the balance, open predictions marked to the live
 * percentages, and the ones already decided.
 *
 * Settling pays coins out to the wallet but deliberately leaves the position row
 * standing as a record of the prediction. Valuing those rows as open would price a
 * correct prediction at zero — the payout already landed in the balance — so only
 * live markets are "open"; settled ones are listed as decided, with what they returned.
 */
function MyPositions({ markets, settledAll, positions, balance, netWorth, openValue, userId, onBrowse }) {
  const [rank, setRank] = useState(null)
  useEffect(() => {
    let alive = true
    getLeaderboard().then(rows => {
      const i = rows.findIndex(r => r.user_id === userId)
      if (alive && i >= 0) setRank(i + 1)
    }).catch(() => {})
    return () => { alive = false }
  }, [userId])

  const rows = []
  for (const m of markets) {
    if (m.status !== 'open' && m.status !== 'closed') continue
    for (const o of m.outcomes) {
      const p = positions[o.id]
      if (!p || !(Number(p.shares) > 0)) continue
      const shares = Number(p.shares)
      const value = shares * o.price
      rows.push({
        key: o.id, market: m, outcome: o, shares,
        cost: Number(p.cost_basis), value, pnl: value - Number(p.cost_basis),
      })
    }
  }
  rows.sort((a, b) => b.value - a.value)

  // Decided: a correct share returned 1 coin, a wrong one 0, a void refunded the stake.
  const decided = []
  for (const m of settledAll) {
    for (const o of m.outcomes) {
      const p = positions[o.id]
      if (!p || !(Number(p.shares) > 0)) continue
      const cost = Number(p.cost_basis) || 0
      const back = m.status === 'void' ? cost : (o.id === m.resolved_outcome_id ? Number(p.shares) : 0)
      decided.push({ key: o.id, market: m, outcome: o, net: back - cost, void: m.status === 'void', right: m.status === 'resolved' && o.id === m.resolved_outcome_id })
    }
  }

  const invested = rows.reduce((n, r) => n + r.cost, 0)
  const worth = rows.reduce((n, r) => n + r.value, 0)
  const pnl = worth - invested
  const up = pnl >= 0
  const now = Date.now()
  const soon = rows.filter(r => r.market.closes_at && new Date(r.market.closes_at) - now < WEEK)
  const later = rows.filter(r => !soon.includes(r))

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <section aria-label="היתרה" className="rounded-card p-4 bg-[#11161D] text-white flex items-center gap-3 dark:bg-surface dark:ring-1 dark:ring-line">
        <MoreCoin size={52} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-[12.5px] opacity-75">יש לך</span>
          <span className="fl-num text-[32px]">{fmtCoins(balance)}</span>
          <span className="text-[12.5px] opacity-80">
            בתחזיות פתוחות: <span className="fl-num">{fmtCoins(Math.round(invested))}</span> · שווה עכשיו <span className="fl-num">{fmtCoins(Math.round(openValue))}</span>
          </span>
        </div>
        {rank && (
          <div className="flex flex-col items-center gap-1 shrink-0 ps-3 border-s border-white/15">
            <span className="fl-num text-[30px] text-[#F2B233]">{rank}</span>
            <span className="text-[12px] opacity-75">בטבלה</span>
          </div>
        )}
      </section>

      {rows.length === 0 ? (
        <MoreEmpty icon="coin" title="אין לך תחזיות פתוחות"
          text={<>יש לך <span className="mkt-coin">{fmtCoins(balance)}</span> סטופרים מוכנים לתחזית הבאה.</>}
          action={<button type="button" onClick={onBrowse} className="btn-primary inline-flex min-h-[44px]"><Target className="w-4 h-4" /> למשחקים הקרובים</button>} />
      ) : (
        <>
          <div className="fl-card p-4">
            <p className="text-[12px] font-semibold text-fg-muted mb-1">השינוי בתחזיות הפתוחות</p>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className={`fl-num text-4xl ${up ? 'text-pos' : 'text-neg'}`} dir="ltr">
                {up ? '+' : ''}{fmtCoins(Math.round(pnl))}
              </span>
              <span className={`stat-pill ${up ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg'}`} dir="ltr">
                {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {invested > 0 ? `${up ? '+' : ''}${Math.round((pnl / invested) * 100)}%` : '0%'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <Stat label="נכנסו" value={fmtCoins(Math.round(invested))} />
              <Stat label="שווה עכשיו" value={fmtCoins(Math.round(worth))} />
              <Stat label="שווי כולל" value={fmtCoins(Math.round(netWorth))} tone={netWorth >= START_BALANCE ? 'text-pos' : 'text-neg'} />
            </div>
          </div>

          {soon.length > 0 && <PositionGroup title="נסגרות השבוע" icon={Lock} rows={soon} />}
          {later.length > 0 && <PositionGroup title={soon.length ? 'בהמשך' : 'פתוחות'} icon={Star} rows={later} />}
        </>
      )}

      {decided.length > 0 && (
        <section aria-label="הוכרעו">
          <MoreSectionHead title="הוכרעו" />
          <div className="fl-card divide-y divide-line overflow-hidden">
            {decided.map(d => (
              <div key={d.key} className="flex items-center gap-3 px-3.5 py-3">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  d.right ? 'bg-pos text-white' : d.void ? 'bg-surface-sunken text-fg-muted' : 'bg-neg text-white'}`}>
                  {d.right ? <Approved className="w-4 h-4" /> : <Declined className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-fg-strong truncate">{d.outcome.label}</p>
                  <p className="text-[12px] text-fg-muted truncate">{d.market.title}{d.void ? ' · בוטלה, הסטופרים חזרו' : ''}</p>
                </div>
                <span className={`fl-num text-[17px] shrink-0 ${d.net > 0 ? 'text-pos' : d.net < 0 ? 'text-neg' : 'text-fg-muted'}`} dir="ltr">
                  {d.net > 0 ? '+' : d.net < 0 ? '−' : ''}{fmtCoins(Math.abs(Math.round(d.net)))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-surface-page py-2">
      <p className="text-[11px] text-fg-muted font-semibold">{label}</p>
      <p className={`fl-num text-[15px] mt-1 ${tone || 'text-fg-strong'}`}>{value}</p>
    </div>
  )
}

function PositionGroup({ title, icon: Icon, rows }) {
  return (
    <section aria-label={title}>
      <h3 className="flex items-center gap-2 text-[17px] font-extrabold text-fg-strong mb-2.5 px-1.5">
        <Icon className="w-4 h-4" /> {title}
        <span className="fl-num text-[13px] text-fg-muted">{rows.length}</span>
      </h3>
      <div className="space-y-2">
        {rows.map(r => {
          const up = r.pnl >= 0
          return (
            <Link key={r.key} to={`/market/${encodeURIComponent(r.market.slug || r.market.id)}`}
              className="mkt-card-hover p-3.5 flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-fl-disc flex items-center justify-center shrink-0 overflow-hidden">
                <OutcomeFace outcome={r.outcome} size={8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-fg-strong truncate">{r.outcome.label}</span>
                  <span className="mkt-num text-xs text-fg-muted shrink-0">{pct(r.outcome.price)}</span>
                </div>
                <p className="text-[12px] text-fg-muted truncate">{r.market.title}</p>
                <p className="text-[12px] text-fg-muted mt-0.5">
                  אם צודקים, גדלים ל־<span className="mkt-coin">{fmtCoins(Math.round(r.shares))}</span>
                </p>
              </div>
              <div className="text-end shrink-0">
                <p className="fl-num text-[17px] text-fg-strong">{fmtCoins(Math.round(r.cost))}</p>
                <p className={`text-[12px] font-bold mt-1 ${up ? 'text-pos' : 'text-neg'}`}>
                  שווה <span className="fl-num">{fmtCoins(Math.round(r.value))}</span> {up ? '▲' : '▼'}
                </p>
                <div className="mt-1"><StatusChip market={r.market} /></div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
