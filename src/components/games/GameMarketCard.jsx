import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Coins, TrendingUp, TrendingDown, Users, Lock, ChevronLeft, Sparkles } from "lucide-react"
import { Crown, Flame, Trophy } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { useAuth } from "@/lib/AuthContext"
import { pct, coins } from "@/lib/market"
import { useSideColors } from "@/components/market/MatchCard"
import {
  getGameMarketOdds, sidesOf, isHidden, leaderChip, trendPoints, multiplier,
  resolvedHeadline, closesLabel, sparkSeries,
} from "@/lib/gameMarket"

/**
 * הוקי מרקט on the game page: what the league's bettors think of this fixture.
 *
 * Renders NOTHING unless `market_game_odds` returns a market — the RPC is the 18+ gate
 * (market_eligible), so this component never decides who sees odds. No skeleton, no
 * error box: a signed-out viewer, a minor, a failed read and a voided market all look
 * the same — the card simply isn't there. Mirrored by the iOS and Android cards.
 */

const marketHref = (odds) => `/market/${encodeURIComponent(odds.slug || odds.market_id)}`

export default function GameMarketCard({ game, teamsMap }) {
  const { user } = useAuth()
  const [odds, setOdds] = useState(null)

  useEffect(() => {
    let alive = true
    setOdds(null)
    if (!user || !game?.id) return
    getGameMarketOdds(game.id).then((o) => { if (alive) setOdds(o) }).catch(() => {})
    return () => { alive = false }
  }, [user?.id, game?.id])

  return <GameMarketCardView odds={odds} teamsMap={teamsMap} />
}

/** The card for a given RPC payload (exported for previews); renders nothing when isHidden. */
export function GameMarketCardView({ odds, teamsMap }) {
  if (isHidden(odds)) return null
  return <MarketCardBody odds={odds} teamsMap={teamsMap} />
}

function MarketCardBody({ odds, teamsMap }) {
  const raw = sidesOf(odds)
  const named = (o, fallback) => o && ({
    ...o,
    team: o.team_id ? teamsMap?.[o.team_id] || null : null,
    name: o.okey === "draw" ? "תיקו" : (teamsMap?.[o.team_id]?.name || o.label || fallback),
  })
  const home = named(raw.home, "בית")
  const draw = named(raw.draw, "תיקו")
  const away = named(raw.away, "חוץ")
  const colors = useSideColors(home, away)
  const status = odds.status
  const open = status === "open"
  const resolved = status === "resolved"
  const traded = Number(odds.trades) > 0
  const chip = leaderChip(odds)
  const series = sparkSeries(odds)
  const winner = resolved ? { home, draw, away }[odds.resolved_okey] : null
  const byKey = { home, draw, away }
  const my = (odds.my || []).filter((p) => Number(p.shares) > 0)

  const subtitle = open ? "הסיכויים לפי המהמרים" : resolved ? "מה המהמרים חשבו" : "היחסים בשריקת הפתיחה"

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
      className="card overflow-hidden relative"
      data-market-status={status}
    >
      {/* warm glow behind the header — the market's own corner of the page */}
      <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full bg-gold/10 blur-3xl" />

      <div className="relative px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-gold/15 text-gold flex items-center justify-center shrink-0"><Coins className="w-4 h-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 font-bold text-sm text-slate-900 dark:text-white">
            הוקי מרקט
            <span className="stat-pill bg-surface-sunken text-fg-muted text-[10px] px-1.5 py-0 font-semibold">18+</span>
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
        </div>
        {open && chip?.kind === "close" && traded && (
          <span className="stat-pill bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[11px] font-bold shrink-0"><Flame className="w-4 h-4" /> משחק צמוד</span>
        )}
      </div>

      <div className="relative p-4 sm:p-5 space-y-4">
        {/* ── hero: home (right in RTL) · draw · away ── */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          <Side o={home} color={colors.home} odds={odds} chip={chip} winner={winner} showTrend={open && traded} />
          <div className={`pt-6 text-center ${winner && winner !== draw ? "opacity-40" : ""}`}>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">תיקו</p>
            <p className="mkt-num text-lg font-black text-slate-600 dark:text-slate-300" dir="ltr">{draw ? pct(draw.price) : "—"}</p>
            {winner && winner === draw && <Crown className="w-4 h-4 text-gold mx-auto mt-0.5" />}
          </div>
          <Side o={away} color={colors.away} odds={odds} chip={chip} winner={winner} showTrend={open && traded} />
        </div>

        <GrowBar home={home} draw={draw} away={away} colors={colors} winner={winner} />

        {/* ── movement ── */}
        {open && !traded ? (
          <p className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300 rounded-xl bg-surface-sunken px-3 py-2.5">
            <Sparkles className="w-4 h-4 text-gold shrink-0" />
            אף אחד עוד לא הימר על המשחק — ההימור הראשון קובע את היחסים
          </p>
        ) : series.length > 0 && (
          <Spark series={series} colors={colors} />
        )}

        {/* ── resolved verdict ── */}
        {resolved && winner && (() => {
          const h = resolvedHeadline(winner.name, winner.price, winner.okey === "draw")
          return (
            <div className={`rounded-xl px-3 py-2.5 ${h.tone === "upset" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : h.tone === "called" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-surface-sunken text-slate-700 dark:text-slate-200"}`}>
              <p className="text-sm font-bold">{h.text}</p>
              {Number(odds.traders) > 0 && (
                <p className="text-[12px] opacity-80 mt-0.5">
                  <span className="mkt-num font-bold">{odds.called ?? 0}</span> מתוך <span className="mkt-num font-bold">{odds.traders}</span> מהמרים צדקו
                </p>
              )}
            </div>
          )
        })()}

        {/* ── my position ── */}
        {my.length > 0 && (
          <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2.5 space-y-0.5">
            {my.map((p) => {
              const o = byKey[p.okey]
              const shares = Math.round(Number(p.shares))
              if (resolved) {
                const won = p.okey === odds.resolved_okey
                return (
                  <p key={p.okey} className="text-[13px] text-slate-800 dark:text-slate-100">
                    {won
                      ? <><Trophy className="w-4 h-4 inline-block align-[-3px]" /> זכית! <span className="mkt-coin">{coins(shares)}</span> מטבעות על {o?.name}</>
                      : <>הפעם לא הלך — {o?.name}</>}
                  </p>
                )
              }
              return (
                <p key={p.okey} className="text-[13px] text-slate-800 dark:text-slate-100">
                  ההימור שלך: <span className="mkt-num font-bold">{coins(shares)}</span> מניות על <b>{o?.name}</b>
                  {" · "}שווי עכשיו ~<span className="mkt-coin">{coins(Math.round(shares * (o?.price || 0)))}</span>
                </p>
              )
            })}
          </div>
        )}

        {/* ── meta + CTA ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <p className="flex-1 min-w-[10rem] flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Users className="w-3 h-3 shrink-0" />
            <span className="whitespace-nowrap"><span className="mkt-num font-bold text-slate-700 dark:text-slate-200">{odds.traders || 0}</span> מהמרים</span>
            {Number(odds.volume) > 0 && <span className="whitespace-nowrap">· <span className="mkt-coin">{coins(odds.volume)}</span> מטבעות בשוק</span>}
            {open && odds.closes_at && <span className="whitespace-nowrap">· נסגר {closesLabel(odds.closes_at)}</span>}
            {status === "closed" && <span className="whitespace-nowrap">· המסחר נסגר</span>}
          </p>
          <Cta odds={odds} traded={traded} />
        </div>
      </div>
    </motion.section>
  )
}

function Side({ o, color, odds, chip, winner, showTrend }) {
  if (!o) return <div />
  const t = showTrend ? trendPoints(o) : null
  const dim = winner && winner !== o
  const mult = odds.status === "open" ? multiplier(o.price) : null
  return (
    <div className={`flex flex-col items-center text-center min-w-0 transition-opacity ${dim ? "opacity-40" : ""}`}>
      <div className="relative">
        <TeamLogo team={o.team} size={12} />
        {winner === o && (
          <span className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-gold text-slate-900 flex items-center justify-center shadow"><Crown className="w-4 h-4" /></span>
        )}
      </div>
      <p className="mt-1.5 text-[13px] font-semibold text-slate-900 dark:text-white truncate max-w-full">{o.name}</p>
      <p className="mkt-num text-3xl font-black leading-tight" style={{ color }} dir="ltr">{pct(o.price)}</p>
      <div className="h-5 flex items-center gap-1.5">
        {mult && <span className="mkt-num text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">×{mult}</span>}
        {t != null && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${t > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`} title="ב-48 שעות">
            {t > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span className="mkt-num" dir="ltr">{t > 0 ? `+${t}` : t}</span> נק׳
          </span>
        )}
      </div>
      {odds.status === "open" && chip?.kind === "favourite" && chip.okey === o.okey && (
        <span className="stat-pill bg-gold/15 text-gold text-[10px] font-bold mt-0.5">פייבוריט</span>
      )}
    </div>
  )
}

/** The 3-way bar, growing from zero the first time it appears. Home sits on the right (RTL start). */
function GrowBar({ home, draw, away, colors, winner }) {
  const [grown, setGrown] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(id) }, [])
  const parts = [
    { o: home, c: colors.home },
    { o: draw, c: "rgb(var(--fg-faint))" },
    { o: away, c: colors.away },
  ].filter((p) => p.o)
  return (
    <div className="flex w-full h-3 overflow-hidden rounded-full bg-surface-sunken gap-0.5">
      {parts.map((p) => (
        <div key={p.o.okey}
          className={`h-full transition-[width,opacity] duration-700 ease-out first:rounded-s-full last:rounded-e-full ${winner && winner !== p.o ? "opacity-40" : ""}`}
          style={{ width: grown ? `${Math.max(p.o.price * 100, 2)}%` : "0%", backgroundColor: p.c }} />
      ))}
    </div>
  )
}

/** Home vs away over the market's life: two lines, no axes, a dot on the latest point. */
function Spark({ series, colors }) {
  const W = 300, H = 56, P = 4
  const pts = useMemo(() => {
    // Scale to the data, not 0–100%: a 42/38 race drawn on the full range is two
    // overlapping flat lines. Keep at least a 20-point window so noise stays small.
    const vals = series.flatMap((s) => [s.home, s.away])
    let lo = Math.min(...vals) - 0.04, hi = Math.max(...vals) + 0.04
    if (hi - lo < 0.2) { const mid = (hi + lo) / 2; lo = mid - 0.1; hi = mid + 0.1 }
    const x = (i) => P + (i * (W - 2 * P)) / Math.max(series.length - 1, 1)
    const y = (v) => P + ((hi - v) / (hi - lo)) * (H - 2 * P)
    const line = (k) => series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join(" ")
    const last = series.length - 1
    return { home: line("home"), away: line("away"), hx: x(last), hy: y(series[last].home), ay: y(series[last].away),
             mid: lo < 0.5 && hi > 0.5 ? y(0.5) : null }
  }, [series])
  return (
    <div className="rounded-xl bg-surface-sunken/60 px-2 py-1.5">
      {/* RTL page, but time runs left → right on a chart */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" dir="ltr" preserveAspectRatio="none" aria-label="תנועת היחסים">
        {pts.mid != null && <line x1={P} x2={W - P} y1={pts.mid} y2={pts.mid} stroke="rgb(var(--fg-faint))" strokeDasharray="3 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        <path d={pts.away} fill="none" stroke={colors.away} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={pts.home} fill="none" stroke={colors.home} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={pts.hx} cy={pts.ay} r="3" fill={colors.away} />
        <circle cx={pts.hx} cy={pts.hy} r="3.5" fill={colors.home} />
      </svg>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center">תנועת היחסים מאז פתיחת השוק</p>
    </div>
  )
}

function Cta({ odds, traded }) {
  const href = marketHref(odds)
  const link = (label) => (
    <Link to={href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand dark:text-brand-light hover:text-brand-hover shrink-0">
      {label} <ChevronLeft className="w-3 h-3" />
    </Link>
  )
  if (odds.status !== "open") return link("לשוק")
  if (odds.block === "conflict") {
    return (
      <div className="w-full flex items-center justify-between gap-2 text-[12px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 shrink-0" /> משחק שלך או שאת/ה שופט/ת בו — אי אפשר להמר עליו</span>
        {link("לצפייה בשוק")}
      </div>
    )
  }
  if (odds.block) return link("לצפייה בשוק")
  return (
    <Link to={href} className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl bg-gold text-slate-900 hover:brightness-110 transition shadow-sm shrink-0">
      <Coins className="w-3.5 h-3.5" /> {traded ? "להמר על המשחק" : "להיות הראשון להמר"}
    </Link>
  )
}
