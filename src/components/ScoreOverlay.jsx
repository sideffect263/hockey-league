import { useEffect, useRef, useState } from "react"
import { getLiveGame, subscribeLiveGame } from "@/lib/live"

// Broadcast-style score bug drawn over the live video: crests, names, score, clock, period.
//
// The video runs behind real time (encode + HLS buffering, ~10–20s) while live_game_state
// arrives instantly, so a naive overlay shows the goal before viewers see it. The player
// measures its own lag (`latencyMs`) and this component shows the state AS IT WAS that
// long ago: every row is kept with the time it arrived, and the clock is counted down
// against `now - latency`. Same clock model as GameTv: a running clock is an absolute
// deadline (clock_ends_at), a paused one a frozen clock_remaining_ms.

const KEEP_MS = 120_000 // history kept for the delay; far beyond any real latency

export default function ScoreOverlay({ gameId, home, away, latencyMs = 0, position = "top-right" }) {
  const history = useRef([]) // [{ at, row }] oldest first
  const [, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!gameId) return
    let alive = true
    const push = (row) => {
      // Stamp with WHEN it happened — updated_at is set by the server (broadcast_game_state
      // writes now()) — not when it reached us, so a late delivery still lines up with the
      // video. A delete (game over) has no row: stamp it on arrival.
      const t = Date.parse(row?.updated_at) || Date.now()
      const h = history.current
      if (h.length && h[h.length - 1].row?.updated_at && h[h.length - 1].row.updated_at === row?.updated_at) return
      h.push({ at: t, row })
      h.sort((a, b) => a.at - b.at)
      // Drop what can no longer be shown, keeping the newest entry older than the window.
      while (h.length > 1 && h[1].at < Date.now() - KEEP_MS) h.shift()
      setTick((n) => n + 1)
    }
    getLiveGame(gameId).then((row) => {
      // Only seed when realtime hasn't already delivered something newer.
      if (alive && !history.current.length) push(row)
    })
    const unsub = subscribeLiveGame(gameId, push)
    return () => { alive = false; unsub?.(); history.current = [] }
  }, [gameId])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const shownAt = now - Math.max(0, latencyMs)
  const live = stateAt(history.current, shownAt)
  if (!live) return null
  return <ScoreBug live={live} remainingMS={clockMsAt(live, shownAt)} home={home} away={away} position={position} />
}

// The row that was current at `at` (history oldest first). Before the first arrival,
// the first row — better a slightly early score than no bug at all on page load.
export function stateAt(history, at) {
  let live = history.length ? history[0].row : null
  for (const e of history) { if (e.at <= at) live = e.row; else break }
  return live
}

// Clock as it read at `at`: a running clock counts down to its deadline, a paused one is frozen.
export function clockMsAt(live, at) {
  return live.is_running && live.clock_ends_at
    ? Math.max(0, new Date(live.clock_ends_at).getTime() - at)
    : Math.max(0, live.clock_remaining_ms ?? 0)
}

export function ScoreBug({ live, remainingMS, home, away, position = "top-right" }) {
  const mm = String(Math.floor(remainingMS / 60000)).padStart(2, "0")
  const ss = String(Math.floor((remainingMS % 60000) / 1000)).padStart(2, "0")
  return (
    // Sized in container units so it scales with the player (and stays proportionate in
    // fullscreen). The wrapper sets `container-type: inline-size`.
    <div className={`pointer-events-none absolute top-[3cqw] ${position === "top-left" ? "left-[3cqw]" : "right-[3cqw]"} flex items-stretch rounded-[0.6em] overflow-hidden shadow-lg select-none`}
      style={{ fontSize: "clamp(10px, 2.3cqw, 30px)" }} aria-label="תוצאה">
      {/* RTL row: the first child is rightmost, so home sits on the right (house rule). */}
      <Side team={home} score={live.home_score ?? 0} />
      <Side team={away} score={live.away_score ?? 0} />
      <div className="flex items-center gap-[0.5em] px-[0.7em] bg-white text-[#0E2350] font-extrabold tabular-nums">
        <span dir="ltr">{mm}:{ss}</span>
        {live.period && <span className="font-bold opacity-70 text-[0.8em]">{live.period}</span>}
        {!live.is_running && <span className="text-amber-600 text-[0.8em]">עצור</span>}
      </div>
    </div>
  )
}

function Side({ team, score }) {
  const [imgError, setImgError] = useState(false)
  useEffect(() => { setImgError(false) }, [team?.logo_url])
  return (
    <div className="flex items-center gap-[0.45em] ps-[0.5em] pe-0 bg-[#0E2350]/90 text-white">
      <span className="w-[0.25em] self-stretch" style={{ background: team?.primary_color || "#3B82F6" }} />
      {team?.logo_url && !imgError && (
        <img src={team.logo_url} alt="" onError={() => setImgError(true)} className="h-[1.5em] w-[1.5em] object-contain" />
      )}
      <span className="font-bold truncate max-w-[9em] py-[0.35em]">{team?.name || "—"}</span>
      <span className="font-extrabold tabular-nums min-w-[1.6em] text-center self-stretch grid place-items-center bg-black/30 px-[0.35em]">{score}</span>
    </div>
  )
}
