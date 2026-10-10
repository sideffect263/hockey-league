import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Coins, Flame, TrendingUp, TrendingDown, Target, Trophy, ChevronLeft, Users, Zap } from "lucide-react"
import TeamLogo from "@/components/TeamLogo"
import { SplitBar, useSideColors } from "@/components/market/MatchCard"
import { pct, gameSides, matchdayLabel } from "@/lib/market"

/**
 * הוקי מרקט cards in the feed. The data comes from the `market_feed` RPC, which
 * returns nothing unless the viewer is market_eligible (18+) — so this component
 * never decides who may see it; if it renders, the server already said yes.
 *
 * Styled as the market, not as the feed: .mkt-card (squarer, terminal-like),
 * monospaced .mkt-num figures, gold coins, and the same split odds bar as the
 * board, so a card reads as "this is the market talking".
 */

const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }
const TZ = "Asia/Jerusalem"
const kickoff = (iso) => (iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "")
const marketHref = (m) => `/market/${encodeURIComponent(m.slug || m.market_id)}`

// The market stores each outcome's label from when it was created; a team renamed
// since (בלג בוגרים → בלג אריות) should read by its current name.
const teamName = (teamsMap, id, fallback) => teamsMap?.[id]?.name || fallback || "—"

function Shell({ kind, icon, title, children, to = "/market", cta = "להוקי מרקט" }) {
  return (
    <motion.div {...fade} className="mkt-card overflow-hidden" data-market-kind={kind}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-line-subtle bg-gold/5">
        <span className="w-6 h-6 rounded-md bg-gold/15 flex items-center justify-center shrink-0">
          <Coins className="w-3.5 h-3.5 text-gold" />
        </span>
        <span className="text-[11px] font-black tracking-wide text-gold whitespace-nowrap shrink-0">הוקי מרקט</span>
        <span className="text-fg-subtle text-[11px] shrink-0">·</span>
        <span className="flex items-center gap-1 text-xs font-bold text-fg-strong min-w-0 truncate">
          {icon}{title}
        </span>
        <span className="ms-auto stat-pill bg-surface-sunken text-fg-muted text-[10px] px-1.5 py-0">18+</span>
      </div>
      <div className="p-4">{children}</div>
      <Link to={to} className="flex items-center justify-end gap-0.5 px-4 py-2.5 border-t border-line-subtle text-[12px] font-bold text-brand hover:bg-surface-inset transition-colors">
        {cta} <ChevronLeft className="w-3.5 h-3.5" />
      </Link>
    </motion.div>
  )
}

/* ---- matchday: the next round's odds ---- */
function withTeams(game, teamsMap) {
  return {
    ...game,
    outcomes: (game.outcomes || []).map((o) => ({
      ...o,
      team: o.team_id ? teamsMap?.[o.team_id] || null : null,
      label: o.okey === "draw" ? "תיקו" : teamName(teamsMap, o.team_id, o.label),
    })),
  }
}

function MatchdayRow({ game, teamsMap }) {
  const m = withTeams(game, teamsMap)
  const { home, draw, away } = gameSides(m)
  const colors = useSideColors(home, away)
  return (
    <Link to={marketHref(game)} className="block rounded-lg p-2.5 -mx-1 hover:bg-surface-inset transition-colors">
      <div className="flex items-center gap-2">
        <span className="mkt-num text-[11px] text-fg-subtle w-10 shrink-0" dir="ltr">{kickoff(game.game_date)}</span>
        <div className="min-w-0 flex-1 space-y-1">
          {[{ o: home, c: colors.home }, { o: away, c: colors.away }].map(({ o, c }, i) => o && (
            <div key={i} className="flex items-center gap-1.5 min-w-0">
              <TeamLogo team={o.team} size={5} />
              <span className="text-[13px] font-semibold text-fg-strong truncate">{o.label}</span>
              <span className="mkt-num text-[12px] font-black ms-auto" style={{ color: c }}>{pct(o.price)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1"><SplitBar home={home} draw={draw} away={away} colors={colors} /></div>
        {draw && <span className="text-[10px] text-fg-muted shrink-0">תיקו <span className="mkt-num font-bold">{pct(draw.price)}</span></span>}
      </div>
    </Link>
  )
}

function MatchdayCard({ item, teamsMap }) {
  const first = item.games?.[0]
  const traders = (item.games || []).reduce((s, g) => s + (g.traders || 0), 0)
  return (
    <Shell kind="matchday" icon={<Flame className="w-3.5 h-3.5 text-orange-500" />}
      title={`היחסים לסיבוב · ${first ? matchdayLabel(first.game_date) : ""}`} cta="להמר על הסיבוב">
      <div className="divide-y divide-line-subtle">
        {(item.games || []).map((g) => <MatchdayRow key={g.market_id} game={g} teamsMap={teamsMap} />)}
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-fg-muted">
        <Users className="w-3 h-3" />
        {traders ? <><span className="mkt-num font-bold text-fg-soft">{traders}</span> הימורים פתוחים על הסיבוב</> : "עוד אין הימורים על הסיבוב — היה הראשון"}
      </p>
    </Shell>
  )
}

/* ---- swing: biggest move of the last 48h ---- */
function SwingCard({ item, teamsMap }) {
  const up = item.to >= item.from
  const o = item.outcome || {}
  const team = o.team_id ? teamsMap?.[o.team_id] : null
  const label = o.okey === "draw" ? "תיקו" : teamName(teamsMap, o.team_id, o.label)
  const fixture = item.home_team_id
    ? `${teamName(teamsMap, item.home_team_id)} נגד ${teamName(teamsMap, item.away_team_id)}`
    : item.title
  const Arrow = up ? TrendingUp : TrendingDown
  return (
    <Shell kind="swing" icon={<Zap className="w-3.5 h-3.5 text-amber-500" />} title="תזוזה חדה ביחסים"
      to={marketHref(item)} cta="לשוק הזה">
      <div className="flex items-center gap-3">
        {team ? <TeamLogo team={team} size={12} /> : <div className="w-12 h-12 rounded-full bg-surface-sunken" />}
        <div className="min-w-0 flex-1">
          <p className="text-base font-extrabold text-fg-strong truncate">{label}</p>
          <p className="text-[12px] text-fg-muted truncate">{fixture}</p>
        </div>
        <div className="text-center shrink-0">
          <div className="flex items-center gap-1.5" dir="ltr">
            <span className="mkt-num text-sm text-fg-subtle line-through">{pct(item.from)}</span>
            <Arrow className={`w-4 h-4 ${up ? "text-emerald-500" : "text-red-500"}`} />
            <span className={`mkt-num text-2xl font-black ${up ? "text-emerald-500" : "text-red-500"}`}>{pct(item.to)}</span>
          </div>
          <p className="text-[10px] text-fg-muted mt-0.5">ב-48 השעות האחרונות</p>
        </div>
      </div>
    </Shell>
  )
}

/* ---- results: how the market called the matchday ---- */
function ResultsCard({ item, teamsMap }) {
  const games = item.games || []
  return (
    <Shell kind="results" icon={<Target className="w-3.5 h-3.5 text-brand" />}
      title={`מי צדק? · ${games[0] ? matchdayLabel(games[0].game_date) : ""}`} cta="לטבלת המהמרים">
      <div className="space-y-2.5">
        {games.map((g) => {
          const w = g.winner || {}
          const isDraw = w.okey === "draw"
          const upset = !isDraw && Number(w.price) < 0.3
          const winTeam = w.team_id ? teamsMap?.[w.team_id] : null
          return (
            <Link key={g.market_id} to={marketHref(g)} className="flex items-center gap-2.5 rounded-lg p-2 -mx-1 hover:bg-surface-inset transition-colors">
              {winTeam ? <TeamLogo team={winTeam} size={8} /> : <div className="w-8 h-8 rounded-full bg-surface-sunken shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-[13px] font-bold text-fg-strong truncate">
                    {isDraw ? "תיקו" : `${teamName(teamsMap, w.team_id, w.label)} ניצחה`}
                  </p>
                  {upset && <span className="shrink-0 stat-pill bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 py-0">הפתעה!</span>}
                </div>
                <p className="text-[11px] text-fg-muted truncate">
                  {/* away:home inside an LTR run, so each score sits beside its own team (home on the right) */}
                  {teamName(teamsMap, g.home_team_id)} <span className="mkt-num font-bold" dir="ltr">{g.away_score}–{g.home_score}</span> {teamName(teamsMap, g.away_team_id)}
                </p>
              </div>
              <div className="text-end shrink-0">
                <p className="text-[10px] text-fg-muted">המרקט נתן</p>
                <p className="mkt-num text-sm font-black text-fg-strong">{pct(w.price)}</p>
              </div>
              <div className="text-end shrink-0 w-11">
                {g.traders
                  ? <><p className="mkt-num text-sm font-black text-gold">{g.called}/{g.traders}</p><p className="text-[10px] text-fg-muted">צדקו</p></>
                  : <p className="text-[10px] text-fg-subtle leading-tight">אין הימורים</p>}
              </div>
            </Link>
          )
        })}
      </div>
    </Shell>
  )
}

/* ---- podium: weekly top 3 ---- */
const MEDALS = ["🥇", "🥈", "🥉"]
function PodiumCard({ item }) {
  const top = item.top || []
  // Visual podium order: 2nd · 1st · 3rd (1st in the middle, raised).
  const order = [top[1], top[0], top[2]]
  const lift = ["mt-4", "mt-0", "mt-7"]
  return (
    <Shell kind="podium" icon={<Trophy className="w-3.5 h-3.5 text-gold" />} title="טבלת המהמרים השבועית" cta="לטבלה המלאה">
      <div className="flex items-start justify-center gap-3">
        {order.map((u, i) => u && (
          <div key={u.user_id} className={`flex-1 max-w-[120px] flex flex-col items-center text-center ${lift[i]}`}>
            <span className="text-xl leading-none mb-1">{MEDALS[top.indexOf(u)]}</span>
            {u.avatar_url
              ? <img src={u.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-gold/40" referrerPolicy="no-referrer" loading="lazy" />
              : <div className="w-12 h-12 rounded-full bg-surface-sunken ring-2 ring-gold/40 flex items-center justify-center text-lg font-black text-fg-muted">{(u.name || "?").trim().charAt(0)}</div>}
            <p className="mt-1.5 text-[12px] font-bold text-fg-strong line-clamp-2 leading-tight">{u.name}</p>
            <p className="mkt-coin text-[13px] mt-0.5">{Number(u.total).toLocaleString("he-IL")}</p>
          </div>
        ))}
      </div>
    </Shell>
  )
}

export default function MarketFeedCard({ post, teamsMap }) {
  const item = post.data || {}
  switch (item.kind) {
    case "matchday": return <MatchdayCard item={item} teamsMap={teamsMap} />
    case "swing": return <SwingCard item={item} teamsMap={teamsMap} />
    case "results": return <ResultsCard item={item} teamsMap={teamsMap} />
    case "podium": return <PodiumCard item={item} />
    default: return null
  }
}
