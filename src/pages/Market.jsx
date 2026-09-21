import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Coins, Loader2, LayoutGrid, Wallet, Trophy, Settings, CalendarDays, Star, History, Gift } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import {
  getBlockReason, getWallet, listMarkets, getMyPositions, getConflicts,
  getActivity, getTrades, pickFeatured,
  coins as fmtCoins, pct, START_BALANCE,
} from '@/lib/market'
import MarketGate from '@/components/market/MarketGate'
import MarketCard, { OutcomeFace, StatusChip } from '@/components/market/MarketCard'
import FeaturedMarket from '@/components/market/FeaturedMarket'
import Leaderboard from '@/components/market/Leaderboard'
import MarketAdmin from '@/components/market/MarketAdmin'
import { useSeasonName } from '@/App'

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

export default function Market() {
  useMarketTheme()
  const { user, isAdmin, loading: authLoading } = useAuth()
  const seasonName = useSeasonName()

  const [reason, setReason] = useState(undefined) // undefined = still checking
  const [wallet, setWallet] = useState(null)
  const [markets, setMarkets] = useState(null)
  const [positions, setPositions] = useState({})
  const [conflicts, setConflicts] = useState(new Map())
  const [activity, setActivity] = useState(new Map())
  const [featuredTrades, setFeaturedTrades] = useState(null)
  const [tab, setTab] = useState('board')

  const load = useCallback(async () => {
    const r = await getBlockReason()
    setReason(r)
    if (r) { setMarkets([]); return }
    const [w, ms, ps, cs, act] = await Promise.all([
      getWallet().catch(() => null),
      listMarkets().catch(() => []),
      getMyPositions().catch(() => ({})),
      getConflicts().catch(() => new Map()),
      getActivity().catch(() => new Map()),
    ])
    setWallet(w); setMarkets(ms); setPositions(ps); setConflicts(cs); setActivity(act)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user) { setReason('signed-out'); setMarkets([]); return }
    load()
  }, [authLoading, user, load])

  const openValue = useMemo(() => {
    if (!markets) return 0
    let v = 0
    for (const m of markets) {
      if (m.status !== 'open' && m.status !== 'closed') continue
      for (const o of m.outcomes) {
        const s = Number(positions[o.id]?.shares || 0)
        if (s > 0) v += s * o.price
      }
    }
    return v
  }, [markets, positions])

  const featured = useMemo(
    () => (markets ? pickFeatured(markets, activity, conflicts) : null),
    [markets, activity, conflicts],
  )

  // The hero's chart is the only thing on the board that needs a market's tape,
  // so it is fetched for that one market after the board has already rendered
  // rather than holding the whole page on a query nothing else reads.
  useEffect(() => {
    let alive = true
    if (!featured) { setFeaturedTrades(null); return }
    setFeaturedTrades(null)
    getTrades(featured.id).then(t => { if (alive) setFeaturedTrades(t) }).catch(() => {})
    return () => { alive = false }
  }, [featured?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || reason === undefined) {
    return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-brand" /></div>
  }
  if (reason) return <MarketGate reason={reason} onUnlocked={load} />

  // A settled market is history, not something to trade. Over a 52-fixture season
  // they would otherwise bury the two or three markets that are actually live, so
  // they move to their own capped section instead of sitting on the board.
  const live = (markets || []).filter(m => m.status === 'open' || m.status === 'closed')
  // The featured market is already on screen, in full, directly above the board.
  const notFeatured = m => m.id !== featured?.id
  const games = live.filter(m => m.kind === 'game')
  const futures = live.filter(m => m.kind === 'futures')
  const settled = (markets || [])
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
      {/* ── Wallet hero ─────────────────────────────────────────────── */}
      <div className="mkt-card p-5 mb-5 bg-gradient-to-bl from-brand/10 to-transparent">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-fg-strong tracking-tight">הוקי מרקט</h1>
            <p className="text-xs text-fg-muted mt-1">
              המחיר הוא ההסתברות. קונים נמוך, מוכרים גבוה — הכול במטבעות משחק.
            </p>
          </div>
          <div className="flex items-center gap-5">
            <div>
              <p className="text-[11px] text-fg-muted font-semibold mb-0.5">מטבעות</p>
              <p className="flex items-center gap-1.5 mkt-coin text-2xl">
                <Coins className="w-5 h-5" />{fmtCoins(wallet?.balance ?? 0)}
              </p>
            </div>
            <div className="ps-5 border-s border-line">
              <p className="text-[11px] text-fg-muted font-semibold mb-0.5">שווי תיק</p>
              <p className={`mkt-num text-2xl font-black ${netWorth >= START_BALANCE ? 'text-pos' : 'text-neg'}`}>
                {fmtCoins(netWorth)}
              </p>
            </div>
          </div>
        </div>
      </div>

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

      {/* ── Tabs ────────────────────────────────────────────────────── */}
      <div className="tab-bar mb-5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={tab === t.key ? 'tab-active' : 'tab-inactive'}>
            <t.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'board' && (
        !markets ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand" /></div>
        ) : (
          <div className="space-y-8">
            {featured && (
              <FeaturedMarket market={featured} trades={featuredTrades || []}
                activity={activity.get(featured.id)} />
            )}
            <Section title="משחקים" icon={CalendarDays} total={games.length}
              empty="אין כרגע משחקים פתוחים למסחר. שווקים נפתחים אוטומטית לכל משחק חדש בלוח.">
              {games.filter(notFeatured).map(m => (
                <MarketCard key={m.id} market={m} myShares={positions} conflict={conflicts.get(m.id)} />
              ))}
            </Section>
            <Section title={seasonName ? `עונת ${seasonName}` : 'שווקי עונה'} icon={Star}
              total={futures.length} empty="אין שווקי עונה פתוחים.">
              {futures.filter(notFeatured).map(m => (
                <MarketCard key={m.id} market={m} myShares={positions} conflict={conflicts.get(m.id)} />
              ))}
            </Section>
            {settled.length > 0 && (
              <Section title="הוכרעו לאחרונה" icon={History} empty="">
                {settled.map(m => (
                  <MarketCard key={m.id} market={m} myShares={positions} />
                ))}
              </Section>
            )}
          </div>
        )
      )}

      {tab === 'mine' && (
        <MyPositions markets={markets || []} positions={positions} balance={wallet?.balance ?? 0} />
      )}
      {tab === 'top' && <Leaderboard />}
      {tab === 'admin' && isAdmin && <MarketAdmin markets={markets || []} onChanged={load} />}

      <p className="text-center text-[11px] text-fg-subtle mt-10 leading-relaxed">
        הוקי מרקט הוא משחק. המטבעות וירטואליים, אין להם שווי כספי, ואי אפשר לקנות,
        למכור או להמיר אותם בכסף אמיתי.
      </p>
    </div>
  )
}

/**
 * `total` counts the section's markets BEFORE the featured one is pulled out of
 * it. Without it a board whose only season market is the hero would render
 * "אין שווקי עונה פתוחים" directly beneath that very market.
 */
function Section({ title, icon: Icon, children, empty, total }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  const has = Array.isArray(items) ? items.length > 0 : !!items
  if (!has && total > 0) return null
  return (
    <section>
      <h2 className="section-head mb-3"><Icon className="w-4 h-4 text-brand" /> {title}</h2>
      {has
        ? <div className="grid gap-3 sm:grid-cols-2">{items}</div>
        : <p className="text-sm text-fg-subtle py-6 text-center mkt-card">{empty}</p>}
    </section>
  )
}

/**
 * Open positions, marked to the live price.
 *
 * Settling pays coins out to the wallet but deliberately leaves the position row
 * standing as a record of the trade. Valuing those rows here would price a
 * winning bet at zero and report it as a total loss — the payout already landed
 * in the balance — so only live markets belong in the portfolio.
 */
function MyPositions({ markets, positions, balance }) {
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
        <p className="text-xs text-fg-subtle">
          יש לך <span className="mkt-coin">{fmtCoins(balance)}</span> מטבעות מוכנים לעבודה.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {rows.map(r => (
        <Link key={r.key} to={`/market/${encodeURIComponent(r.market.slug || r.market.id)}`} className="mkt-card-hover p-4 block">
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <div className="min-w-0">
              <p className="text-[11px] text-fg-muted truncate">{r.market.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <OutcomeFace outcome={r.outcome} size={6} />
                <span className="font-bold text-fg-strong truncate">{r.outcome.label}</span>
                <span className="mkt-num text-xs text-fg-muted">{pct(r.outcome.price)}</span>
              </div>
            </div>
            <StatusChip market={r.market} />
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Cell label="מניות" value={r.shares.toFixed(1)} />
            <Cell label="עלות" value={fmtCoins(r.cost)} />
            <Cell label="שווי" value={fmtCoins(r.value)}
              tone={r.pnl >= 0 ? 'text-pos' : 'text-neg'}
              sub={`${r.pnl >= 0 ? '+' : ''}${fmtCoins(r.pnl)}`} />
          </dl>
        </Link>
      ))}
    </div>
  )
}

function Cell({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg bg-surface-inset py-2">
      <dt className="text-[10px] text-fg-subtle font-semibold">{label}</dt>
      <dd className={`mkt-num font-bold text-sm ${tone || 'text-fg-strong'}`} dir="ltr">{value}</dd>
      {sub && <dd className={`mkt-num text-[10px] ${tone}`} dir="ltr">{sub}</dd>}
    </div>
  )
}
