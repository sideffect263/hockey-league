import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
import { clockString } from "@/lib/game/format"
import { CrestDisc, FLScore, LiveChip } from "@/components/fl/Floodlight"
import { teamBlend, BLEND_VIGNETTE } from "@/lib/flTeam"
import { entityPath } from "@/lib/slugs"

/**
 * Compact "watch now" strips for games being officiated live. One row per live
 * game, each ticking its own deadline-based clock (running → clock_ends_at − now;
 * paused → the frozen remaining ms), linking to the full scoreboard on
 * /games/:id. Renders nothing when nothing is live.
 *
 * The live_game_state row carries only game_id + scores, so the caller resolves
 * teams via gamesById + teamsMap (the same id-map pattern used across the app).
 */

export function remainingFrom(live) {
  if (!live) return 0
  if (live.is_running && live.clock_ends_at) {
    return Math.max(0, new Date(live.clock_ends_at).getTime() - Date.now())
  }
  return Math.max(0, live.clock_remaining_ms ?? 0)
}

/** Remaining ms on a live row's clock, ticking against its deadline while it runs. */
export function useLiveClock(live) {
  const [remaining, setRemaining] = useState(() => remainingFrom(live))
  useEffect(() => {
    setRemaining(remainingFrom(live))
    if (!live?.is_running || !live?.clock_ends_at) return
    const iv = setInterval(() => setRemaining(remainingFrom(live)), 250)
    return () => clearInterval(iv)
  }, [live])
  return remaining
}

/** One live game as a Floodlight strip: the two teams' blend, home RIGHT, score + clock. */
function LiveRow({ live, home, away }) {
  const remaining = useLiveClock(live)
  const ended = live.phase === "over"

  return (
    <Link
      to={entityPath('games', live.game_id)}
      dir="rtl"
      className="group relative isolate flex items-center gap-2 overflow-hidden rounded-card p-3 text-white"
      style={{ backgroundImage: teamBlend(home, away) }}
      aria-label={`${ended ? "הסתיים" : "שידור חי"}: ${home?.name || "בית"} ${live.home_score ?? 0}, ${away?.name || "חוץ"} ${live.away_score ?? 0}`}
    >
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={{ backgroundImage: BLEND_VIGNETTE }} />
      <div className="flex flex-col items-center gap-1 min-w-0 flex-1 text-center">
        <CrestDisc team={home} size={32} />
        <span className="max-w-full font-bold text-[12px] leading-tight line-clamp-2">{home?.name || "בית"}</span>
      </div>
      <div className="shrink-0 flex flex-col items-center gap-1 px-1">
        <FLScore home={live.home_score ?? 0} away={live.away_score ?? 0} size={26} />
        {ended
          ? <span className="text-[11px] font-bold opacity-85">{live.period || "תוצאה סופית"}</span>
          : <span className="inline-flex items-center gap-1.5"><LiveChip className="!h-5 !px-2 !text-[10px]" /><span dir="ltr" className="fl-num text-[12px]">{clockString(remaining)}</span></span>}
      </div>
      <div className="flex flex-col items-center gap-1 min-w-0 flex-1 text-center">
        <CrestDisc team={away} size={32} />
        <span className="max-w-full font-bold text-[12px] leading-tight line-clamp-2">{away?.name || "חוץ"}</span>
      </div>
      <ChevronLeft className="shrink-0 w-4 h-4 opacity-70" />
    </Link>
  )
}

export default function LiveGameBanner({ liveGames, gamesById, teamsMap, className = "" }) {
  if (!liveGames?.length) return null
  return (
    <div className={`space-y-2 ${className}`}>
      {liveGames.map(l => {
        const g = gamesById?.[l.game_id]
        return (
          <LiveRow
            key={l.game_id}
            live={l}
            home={teamsMap?.[g?.home_team_id]}
            away={teamsMap?.[g?.away_team_id]}
          />
        )
      })}
    </div>
  )
}
