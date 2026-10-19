import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Coins, LayoutGrid, Wallet, Trophy, Settings, CalendarDays, Star, History, Gift,
  ChevronDown, TrendingUp, TrendingDown, Lock, Target,
} from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  loadBoard, cachedBoard, invalidateBoard, pickFeaturedList, groupByMatchday, holdsAny,
  coins as fmtCoins, pct, START_BALANCE,
} from '@/lib/market'
import MarketGate from '@/components/market/MarketGate'
import MarketCard, { OutcomeFace, StatusChip } from '@/components/market/MarketCard'
import MatchCard, { GameRow } from '@/components/market/MatchCard'
import { FeaturedCarousel } from '@/components/market/FeaturedMarket'
import Leaderboard from '@/components/market/Leaderboard'
import MarketAdmin from '@/components/market/MarketAdmin'
import { useSeasonName } from '@/App'
import { MarketSkeleton } from "@/components/skeletons/PageSkeletons"

/**
 * Repoints the design tokens at the market palette for as long as this screen is
 * mounted. It goes on <html> rather than on a wrapper so the sticky header
 * changes with the page — the market is meant to feel like its own room, not a
 * differently-coloured panel inside the league's.
 */
export function useMarketTheme() {
  useEffect(() => {
    document.documentElement.classList.add('market-theme')
    return () => document.documentElement.classList.remove('market-theme')
  }, [])
}

/** Season markets shown on the "הכל" board before "כל שווקי העונה". */
const SEASON_PREVIEW = 4
/** Matchdays listed on the "הכל" board after the next one. */
const LATER_PREVIEW = 2

export default function Market() {
  useMarketTheme()
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
  // session's user id is known the moment the page mounts.
  useEffect(() => {
    if (user) {
      // Once per user: authLoading flipping later must not fire a second load.
      if (loadedFor.current !== user.id) { loadedFor.current = user.id; load() }
      return
    }
    if (!authLoading) setBoard({ reason: 'signed-out', markets: [] })
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
  if (board.reason) return <MarketGate reason={board.reason} onUnlocked={() => { invalidateBoard(); load() }} />

  // A settled market is history, not something to trade, so it moves to its own
  // capped strip at the bottom instead of sitting between live ones.
  const live = markets.filter(m => m.status === 'open' || m.status === 'closed')
  const games = live.filter(m => m.kind === 'game')
  const futures = live.filter(m => m.kind === 'futures')
  const mineCount = live.filter(m => holdsAny(m, positions)).length
  const settled = markets
    .filter(m => m.status === 'resolved' || m.status === 'void')
    .sort((a, b) => new Date(b.resolved_at || 0) - new Date(a.resolved_at || 0))
    .slice(0, 6)
  const netWorth = Number(wallet?.balance || 0) + openValue

  const TABS = [
    { key: 'board', label: 'שווקים', icon: LayoutGrid },
    { key: 'mine', label: 'התיק שלי', icon: Wallet },
    { key: 'top', label: 'מובילים', icon: Trophy },
    ...(isAdmin ? [{ key: 'admin', label: 'ניהול', icon: Settings }] : []),
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <WalletHero balance={wallet?.balance} netWorth={netWorth} ready={!!wallet} />

      {/* The allowance is paid on read, so this is the only moment the trader is
          told it happened — a silent top-up reads as a balance that drifts. */}
      {Number(wallet?.allowance_credited) > 0 && (
        <div className="mkt-card px-4 py-2.5 mb-5 flex items-center gap-2 border-brand/40 bg-brand/5">
          <Gift className="w-4 h-4 text-brand shrink-0" />
          <p className="text-xs text-fg-soft">
            דמי כיס שבועיים: <span className="mkt-coin">{fmtCoins(wallet.allowance_credited)}</span> מטבעות
            {Number(wallet.allowance_weeks) > 1 && ` (${wallet.allowance_weeks} שבועות)`}
          </p>
        </div>
      )}

      <div className="tab-bar mb-5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={tab === t.key ? 'tab-active' : 'tab-inactive'}>
            <t.icon className="w-4 h-4" />
            <span className="text-xs sm:text-sm">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <Board
          filter={filter} setFilter={setFilter}
          featured={featured}
          games={games} futures={futures} settled={settled} mineCount={mineCount}
          live={live} positions={positions} conflicts={conflicts} activity={activity}
          seasonName={seasonName}
        />
      )}

      {tab === 'mine' && (
        <MyPositions markets={markets} positions={positions} balance={wallet?.balance ?? 0}
          netWorth={netWorth} onBrowse={() => setTab('board')} />
      )}
      {tab === 'top' && <Leaderboard />}
      {tab === 'admin' && isAdmin && <MarketAdmin markets={markets} onChanged={load} />}

      <p className="text-center text-[11px] text-fg-subtle mt-10 leading-relaxed">
        הוקי מרקט הוא משחק. המטבעות וירטואליים, אין להם שווי כספי, ואי אפשר לקנות,
        למכור או להמיר אותם בכסף אמיתי.
      </p>
    </div>
  )
}

function WalletHero({ balance, netWorth, ready }) {
  const up = netWorth >= START_BALANCE
  const change = netWorth - START_BALANCE
  return (
    <div className="mkt-card p-5 mb-5 bg-gradient-to-bl from-brand/15 via-brand/[0.04] to-transparent relative overflow-hidden">
      {/* A faint coin mark behind the numbers — the room's signage, not data. */}
      <Coins className="absolute -bottom-6 -start-6 w-32 h-32 text-gold/[0.07] pointer-events-none" aria-hidden />
      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-fg-strong tracking-tight">הוקי מרקט</h1>
          <p className="text-xs text-fg-muted mt-1">
            המחיר הוא ההסתברות. קונים נמוך, מוכרים גבוה — הכול במטבעות משחק.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div>
            <p className="text-[11px] text-fg-muted font-semibold mb-0.5">מטבעות</p>
            {ready ? (
              <p className="flex items-center gap-1.5 mkt-coin text-2xl"><Coins className="w-5 h-5" />{fmtCoins(balance)}</p>
            ) : <span className="block h-8 w-20 rounded-md bg-surface-sunken animate-pulse" />}
          </div>
          <div className="ps-5 border-s border-line">
            <p className="text-[11px] text-fg-muted font-semibold mb-0.5">שווי תיק</p>
            {ready ? (
              <div className="flex items-baseline gap-2">
                <p className={`mkt-num text-2xl font-black ${up ? 'text-pos' : 'text-neg'}`}>{fmtCoins(Math.round(netWorth))}</p>
                <span className={`mkt-num text-[11px] font-bold ${up ? 'text-pos' : 'text-neg'}`} dir="ltr">
                  {change >= 0 ? '+' : ''}{Math.round((change / START_BALANCE) * 100)}%
                </span>
              </div>
            ) : <span className="block h-8 w-20 rounded-md bg-surface-sunken animate-pulse" />}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The board, with the forty-fixture problem solved by structure rather than by
 * scrolling: season markets come first (there are only a handful), then the next
 * matchday in full, then later rounds folded to one line per game. The chips on
 * top jump straight to one kind.
 */
function Board({
  filter, setFilter, featured, games, futures, settled, mineCount,
  live, positions, conflicts, activity, seasonName,
}) {
  const [showAllRounds, setShowAllRounds] = useState(false)
  const rounds = useMemo(() => groupByMatchday(games), [games])
  const seasonTitle = seasonName ? `עונת ${seasonName}` : 'שווקי עונה'

  const FILTERS = [
    { key: 'all', label: 'הכל' },
    { key: 'season', label: 'עונתיים', n: futures.length, icon: Star },
    { key: 'games', label: 'משחקים', n: games.length, icon: CalendarDays },
    ...(mineCount ? [{ key: 'mine', label: 'שלי', n: mineCount, icon: Wallet }] : []),
  ]

  const card = m => <MarketCard key={m.id} market={m} myShares={positions} conflict={conflicts.get(m.id)} />
  const [next, ...later] = rounds
  const laterShown = filter === 'games' || showAllRounds ? later : later.slice(0, LATER_PREVIEW)
  const hiddenRounds = later.length - laterShown.length

  return (
    <div>
      <div className="sticky top-16 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 py-2 mb-4 bg-surface-page/85 backdrop-blur">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                filter === f.key
                  ? 'bg-brand text-brand-fg border-brand'
                  : 'bg-surface text-fg-muted border-line hover:text-fg-soft hover:border-line-strong'
              }`}>
              {f.icon && <f.icon className="w-3.5 h-3.5" />}
              {f.label}
              {f.n != null && (
                <span className={`mkt-num text-[10px] rounded-full px-1.5 ${filter === f.key ? 'bg-white/20' : 'bg-surface-sunken'}`}>{f.n}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-10">
        {filter === 'all' && featured.length > 0 && (
          <FeaturedCarousel markets={featured} activity={activity} />
        )}

        {(filter === 'all' || filter === 'season') && (
          <Section title={seasonTitle} icon={Star} accent="gold" count={futures.length}
            action={filter === 'all' && futures.length > SEASON_PREVIEW
              ? { label: `כל ${futures.length} השווקים`, onClick: () => setFilter('season') } : null}>
            {futures.length === 0 ? (
              <Empty icon={Star} text="אין שווקי עונה פתוחים." />
            ) : (
              <Grid>
                {(filter === 'all'
                  ? futures.filter(m => !featured.some(f => f.id === m.id)).slice(0, SEASON_PREVIEW)
                  : futures
                ).map(card)}
              </Grid>
            )}
          </Section>
        )}

        {(filter === 'all' || filter === 'games') && (
          games.length === 0 ? (
            <Section title="משחקים" icon={CalendarDays}>
              <Empty icon={CalendarDays} text="אין כרגע משחקים פתוחים למסחר. שווקים נפתחים אוטומטית לכל משחק חדש בלוח." />
            </Section>
          ) : (
            <>
              <Section title={`המחזור הקרוב · ${next.label}`} icon={CalendarDays} count={next.markets.length}>
                <Grid>
                  {next.markets.map(m => (
                    <MatchCard key={m.id} market={m} positions={positions}
                      conflict={conflicts.get(m.id)} activity={activity.get(m.id)} />
                  ))}
                </Grid>
              </Section>

              {laterShown.length > 0 && (
                <Section title="בהמשך העונה" icon={CalendarDays} count={later.reduce((n, r) => n + r.markets.length, 0)}>
                  <div className="space-y-3">
                    {laterShown.map(r => (
                      <div key={r.key} className="mkt-card overflow-hidden">
                        <div className="px-3 py-2 bg-surface-inset border-b border-line-subtle flex items-center gap-2">
                          <span className="text-xs font-extrabold text-fg-soft">{r.label}</span>
                          <span className="mkt-num text-[10px] text-fg-subtle">{r.markets.length} משחקים</span>
                          <span className="ms-auto flex gap-1 text-[10px] text-fg-subtle font-semibold">
                            <span className="w-9 sm:w-10 text-center">בית</span>
                            <span className="w-9 sm:w-10 text-center">תיקו</span>
                            <span className="w-9 sm:w-10 text-center">חוץ</span>
                          </span>
                        </div>
                        <div className="divide-y divide-line-subtle">
                          {r.markets.map(m => (
                            <GameRow key={m.id} market={m} positions={positions} conflict={conflicts.get(m.id)} />
                          ))}
                        </div>
                      </div>
                    ))}
                    {hiddenRounds > 0 && (
                      <button onClick={() => setShowAllRounds(true)}
                        className="w-full mkt-card py-3 text-xs font-bold text-brand hover:bg-surface-inset transition-colors inline-flex items-center justify-center gap-1.5">
                        <ChevronDown className="w-4 h-4" />
                        עוד {hiddenRounds} מחזורים ({later.slice(LATER_PREVIEW).reduce((n, r) => n + r.markets.length, 0)} משחקים)
                      </button>
                    )}
                  </div>
                </Section>
              )}
            </>
          )
        )}

        {filter === 'mine' && (
          <Section title="השווקים שלי" icon={Wallet} count={mineCount}>
            <Grid>{live.filter(m => holdsAny(m, positions)).map(card)}</Grid>
          </Section>
        )}

        {filter === 'all' && settled.length > 0 && (
          <Section title="הוכרעו לאחרונה" icon={History}>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
              {settled.map((m, i) => (
                <div key={m.id} className="mkt-rise shrink-0 w-[260px] snap-start" style={{ animationDelay: `${i * 45}ms` }}>
                  <MarketCard market={m} myShares={positions} />
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, icon: Icon, children, count, accent = 'brand', action = null }) {
  const chip = accent === 'gold' ? 'bg-gold/10 text-gold' : 'bg-brand/10 text-brand'
  return (
    <section>
      <div className="flex items-center gap-2.5 mb-4">
        <span className={`flex items-center justify-center w-8 h-8 rounded-xl shrink-0 ${chip}`}>
          <Icon className="w-4 h-4" />
        </span>
        <h2 className="text-base font-extrabold text-fg-strong">{title}</h2>
        {count > 0 && (
          <span className="mkt-num text-[11px] font-bold text-fg-muted bg-surface-sunken rounded-full min-w-[1.5rem] text-center px-2 py-0.5">
            {count}
          </span>
        )}
        <span className="flex-1 h-px bg-line-subtle" />
        {action && (
          <button onClick={action.onClick} className="text-xs font-bold text-brand hover:underline shrink-0">
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Grid({ children }) {
  const list = (Array.isArray(children) ? children : [children]).filter(Boolean)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {list.map((item, i) => (
        <div key={item.key ?? i} className="mkt-rise" style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
          {item}
        </div>
      ))}
    </div>
  )
}

function Empty({ icon: Icon, text }) {
  return (
    <div className="mkt-card border-dashed py-10 px-6 text-center">
      <Icon className="w-6 h-6 text-fg-faint mx-auto mb-2" />
      <p className="text-sm text-fg-subtle max-w-sm mx-auto leading-relaxed">{text}</p>
    </div>
  )
}

const WEEK = 7 * 86400000

/**
 * Open positions, marked to the live price.
 *
 * Settling pays coins out to the wallet but deliberately leaves the position row
 * standing as a record of the trade. Valuing those rows here would price a
 * winning bet at zero and report it as a total loss — the payout already landed
 * in the balance — so only live markets belong in the portfolio.
 */
function MyPositions({ markets, positions, balance, netWorth, onBrowse }) {
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

  if (!rows.length) {
    return (
      <div className="mkt-card p-10 text-center">
        <Wallet className="w-8 h-8 text-fg-faint mx-auto mb-3" />
        <p className="text-sm text-fg-muted mb-1">אין לך פוזיציות פתוחות</p>
        <p className="text-xs text-fg-subtle mb-4">
          יש לך <span className="mkt-coin">{fmtCoins(balance)}</span> מטבעות מוכנים לעבודה.
        </p>
        <button onClick={onBrowse} className="btn-primary inline-flex">
          <Target className="w-4 h-4" /> למשחקים הקרובים
        </button>
      </div>
    )
  }

  const invested = rows.reduce((n, r) => n + r.cost, 0)
  const worth = rows.reduce((n, r) => n + r.value, 0)
  const pnl = worth - invested
  const up = pnl >= 0
  const now = Date.now()
  const soon = rows.filter(r => r.market.closes_at && new Date(r.market.closes_at) - now < WEEK)
  const later = rows.filter(r => !soon.includes(r))

  return (
    <div className="space-y-6">
      <div className="mkt-card p-5 bg-gradient-to-bl from-brand/10 to-transparent">
        <p className="text-[11px] font-semibold text-fg-muted mb-1">רווח/הפסד על פוזיציות פתוחות</p>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className={`mkt-num text-4xl font-black ${up ? 'text-pos' : 'text-neg'}`} dir="ltr">
            {up ? '+' : ''}{fmtCoins(Math.round(pnl))}
          </span>
          <span className={`stat-pill ${up ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg'}`} dir="ltr">
            {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {invested > 0 ? `${up ? '+' : ''}${Math.round((pnl / invested) * 100)}%` : '0%'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 text-center">
          <Stat label="הושקע" value={fmtCoins(Math.round(invested))} />
          <Stat label="שווה עכשיו" value={fmtCoins(Math.round(worth))} />
          <Stat label="שווי תיק כולל" value={fmtCoins(Math.round(netWorth))} tone={netWorth >= START_BALANCE ? 'text-pos' : 'text-neg'} />
        </div>
      </div>

      {soon.length > 0 && (
        <PositionGroup title="נסגרים השבוע" icon={Lock} rows={soon} />
      )}
      {later.length > 0 && (
        <PositionGroup title={soon.length ? 'בהמשך' : 'הפוזיציות שלי'} icon={Star} rows={later} />
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg bg-surface/70 border border-line-subtle py-2">
      <p className="text-[10px] text-fg-subtle font-semibold">{label}</p>
      <p className={`mkt-num font-bold text-sm ${tone || 'text-fg-strong'}`}>{value}</p>
    </div>
  )
}

function PositionGroup({ title, icon: Icon, rows }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-extrabold text-fg-strong mb-2.5">
        <Icon className="w-4 h-4 text-brand" /> {title}
        <span className="mkt-num text-[11px] font-bold text-fg-muted bg-surface-sunken rounded-full px-2">{rows.length}</span>
      </h3>
      <div className="space-y-2">
        {rows.map(r => {
          const up = r.pnl >= 0
          return (
            <Link key={r.key} to={`/market/${encodeURIComponent(r.market.slug || r.market.id)}`}
              className={`mkt-card-hover p-3.5 flex items-center gap-3 border-s-4 ${up ? 'border-s-pos' : 'border-s-neg'}`}>
              <OutcomeFace outcome={r.outcome} size={10} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-fg-strong truncate">{r.outcome.label}</span>
                  <span className="mkt-num text-xs text-fg-muted shrink-0">{pct(r.outcome.price)}</span>
                </div>
                <p className="text-[11px] text-fg-muted truncate">{r.market.title}</p>
                <p className="text-[11px] text-fg-subtle mt-0.5">
                  אם זה יקרה: <span className="mkt-coin">{fmtCoins(Math.round(r.shares))}</span>
                </p>
              </div>
              <div className="text-end shrink-0">
                <p className="mkt-num font-black text-fg-strong">{fmtCoins(Math.round(r.value))}</p>
                <p className={`mkt-num text-[11px] font-bold ${up ? 'text-pos' : 'text-neg'}`} dir="ltr">
                  {up ? '+' : ''}{fmtCoins(Math.round(r.pnl))}
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
