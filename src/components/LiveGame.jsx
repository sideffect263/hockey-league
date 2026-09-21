import { useState, useEffect } from "react"
import { getLiveGame, subscribeLiveGame } from "@/lib/live"
import { clockString } from "@/lib/game/format"
import TeamLogo from "@/components/TeamLogo"
import { Skeleton, SkeletonBlock } from "@/components/ui/Skeleton"

/**
 * Public live scoreboard for a game in progress. Reads the `live_game_state`
 * row the judge broadcasts, subscribes for changes, and reconstructs the clock
 * on the client:
 *   - running  → remaining = clock_ends_at − now, re-derived every 200ms
 *   - paused   → clock_remaining_ms, frozen
 * No login required to watch. Renders nothing if there's no live data (the
 * parent then shows its normal content).
 */

// Remaining ms for the live row. Uses the absolute deadline while running so
// every viewer's clock agrees regardless of when they opened the page.
function remainingFrom(live) {
  if (!live) return 0
  if (live.is_running && live.clock_ends_at) {
    return Math.max(0, new Date(live.clock_ends_at).getTime() - Date.now())
  }
  return Math.max(0, live.clock_remaining_ms ?? 0)
}

// The judge board heartbeats (~every 10s) while the clock runs. If `updated_at`
// goes this stale, the judge has disconnected (tab closed / phone dead) — freeze
// the clock instead of letting it run down to 0 with nobody officiating.
const STALE_MS = 25000
function judgeGone(live) {
  if (!live?.is_running || !live?.updated_at) return false
  return Date.now() - new Date(live.updated_at).getTime() > STALE_MS
}

function TeamPanel({ team, score, fallbackName }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-2.5 text-center">
      <TeamLogo team={team} size={14} />
      <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate w-full">
        {team?.name || fallbackName}
      </span>
      <span className="text-5xl sm:text-7xl font-extrabold tabular-nums leading-none text-slate-900 dark:text-white">
        {score ?? 0}
      </span>
    </div>
  )
}

const EVENT_META = {
  goal:    { icon: "⚽", label: "שער", accent: "text-emerald-600 dark:text-emerald-400" },
  blue:    { icon: "🟦", label: "כרטיס כחול", accent: "text-blue-600 dark:text-blue-400" },
  red:     { icon: "🟥", label: "כרטיס אדום", accent: "text-red-600 dark:text-red-400" },
  foul:    { icon: "🚩", label: "עבירה", accent: "text-slate-500 dark:text-slate-400" },
  timeout: { icon: "⏱️", label: "פסק זמן", accent: "text-amber-600 dark:text-amber-400" },
  break:   { icon: "⏸️", label: "מנוחה", accent: "text-slate-500 dark:text-slate-400" },
}

// One row in the live play-by-play. Events arrive fully resolved (player name +
// team side + game-clock time + period) in live_game_state.state, so this stays dumb.
// Events are aligned to their team's side of the scoreboard: home → right, away →
// left. Period breaks (no team) render as a centered divider.
function LiveEventRow({ ev, homeName, awayName }) {
  const meta = EVENT_META[ev.type] || EVENT_META.foul
  const time = ev.timeMS != null ? clockString(ev.timeMS) : null
  const when = [ev.period, time].filter(Boolean).join(" · ")

  // Break / period boundary — no team, so render it centered as a divider.
  if (ev.side == null) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700/60" />
        <span className="shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {meta.icon} {meta.label}{ev.period ? ` · מחצית ${ev.period}` : ""}
        </span>
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700/60" />
      </div>
    )
  }

  const isHome = ev.side === "home"
  const teamName = isHome ? homeName : awayName
  return (
    <div className="flex">
      <div className={`inline-flex items-start gap-2 max-w-[88%] rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800/70 ${isHome ? "ml-auto" : "mr-auto"}`}>
        <span className="text-lg leading-none shrink-0 mt-0.5" aria-hidden>{meta.icon}</span>
        <div className="min-w-0 text-right">
          <div className="text-sm">
            <span className={`font-bold ${meta.accent}`}>{meta.label}</span>
            {ev.player && <span className="text-slate-700 dark:text-slate-200"> · {ev.player}</span>}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{teamName}{when ? ` · ${when}` : ""}</div>
        </div>
      </div>
    </div>
  )
}

export default function LiveGame({ gameId, home, away, initial = null }) {
  const [live, setLive] = useState(initial)
  const [loading, setLoading] = useState(!initial)
  const [remaining, setRemaining] = useState(() => remainingFrom(initial))
  const [stale, setStale] = useState(() => judgeGone(initial))

  // Initial fetch (skipped when the parent seeds `initial`) + realtime subscription.
  useEffect(() => {
    let alive = true
    if (!initial) {
      getLiveGame(gameId).then((row) => {
        if (!alive) return
        setLive(row)
        setLoading(false)
      })
    }
    const unsub = subscribeLiveGame(gameId, (row) => { if (alive) setLive(row) })
    return () => { alive = false; unsub() }
    // `initial` is a one-time seed; re-subscribing on gameId only is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // Client-ticked clock. Re-syncs immediately on every new row, then ticks against
  // the fixed deadline while running — unless the judge's heartbeat goes stale, in
  // which case the clock freezes at its last value ("ממתין לשופט").
  useEffect(() => {
    const tick = () => {
      if (judgeGone(live)) { setStale(true); return } // freeze: stop updating remaining
      setStale(false)
      setRemaining(remainingFrom(live))
    }
    tick()
    if (!live?.is_running || !live?.clock_ends_at) return
    const iv = setInterval(tick, 200)
    return () => clearInterval(iv)
  }, [live])

  if (loading) {
    return (
      <div className="card p-6 min-h-[160px]">
        <SkeletonBlock className="space-y-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-4 w-2/3" />
        </SkeletonBlock>
      </div>
    )
  }

  // No live data → let the parent render its normal (scheduled/completed) view.
  if (!live) return null

  const running = !!live.is_running
  const ended = live.phase === "over"
  const waiting = running && stale  // clock frozen: the judge's heartbeat went silent

  return (
    <div className="card relative overflow-hidden p-5 sm:p-8 ring-1 ring-brand/40">
      {/* brand accent strip */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-brand to-brand-hover" />

      {/* status row: live pulse (right, RTL) + period (left) */}
      <div className="flex items-center justify-between mb-4">
        {ended ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
            תוצאה סופית
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-red-600 dark:text-red-400" aria-label="משחק חי">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            משחק חי
          </span>
        )}
        {live.period && (
          <span className="stat-pill bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light">
            {live.period}
          </span>
        )}
      </div>

      {/* scoreboard: home (right) | clock | away (left) — each score standalone
          to sidestep the RTL away:home digit-pairing gotcha. */}
      <div className="flex items-center gap-2 sm:gap-4">
        <TeamPanel team={home} score={live.home_score} fallbackName="בית" />
        <div className="shrink-0 flex flex-col items-center gap-2">
          <div className={`font-mono font-extrabold tabular-nums leading-none text-5xl sm:text-8xl ${running && !waiting ? "text-brand" : "text-slate-500 dark:text-slate-400"}`}>
            {clockString(remaining)}
          </div>
          <span className={`text-xs font-semibold uppercase tracking-wide ${waiting ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>
            {waiting ? "ממתין לשופט" : running ? "רץ" : ended ? "הסתיים" : "מושהה"}
          </span>
        </div>
        <TeamPanel team={away} score={live.away_score} fallbackName="חוץ" />
      </div>

      {/* Live play-by-play — goals, cards and fouls the judge broadcasts. */}
      {Array.isArray(live.state?.events) && live.state.events.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700/50">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2.5">מהלך המשחק</h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {[...live.state.events].reverse().map((ev, i) => (
              <LiveEventRow key={ev.id || i} ev={ev} homeName={home?.name || "בית"} awayName={away?.name || "חוץ"} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
