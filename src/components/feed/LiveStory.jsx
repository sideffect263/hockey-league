import { useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { X } from "lucide-react"
import { GoalIcon as Ball } from "@/components/icons/BrandIcons"
import { CrestDisc, FLScore, LiveChip } from "@/components/fl/Floodlight"
import { teamBlend } from "@/lib/flTeam"
import { entityPath } from "@/lib/slugs"
import { clockString } from "@/lib/game/format"
import { useLiveClock } from "@/components/LiveGameBanner"

/**
 * A tapped LIVE story (LiveStory board; iOS LiveStoryView): the game full screen on night —
 * both crests, LIVE and close; the score band in the two teams' colours with the ticking
 * clock; the last events from the judge board's play-by-play; "לעמוד המשחק" (the live
 * player, cheering and comments are on the game page). Esc / ✕ / backdrop close it.
 */
export default function LiveStory({ live, game, home, away, onClose }) {
  const remaining = useLiveClock(live)
  const closeRef = useRef(null)
  const ended = live?.phase === "over"

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [onClose])

  const events = (live?.state?.events || []).filter(e => e.type === "goal" || e.type === "red" || e.type === "blue").slice(-4).reverse()
  const blend = teamBlend(home, away)

  return (
    <div role="dialog" aria-modal="true" aria-label={`${home?.name || ""} נגד ${away?.name || ""}, שידור חי`}
      className="fixed inset-0 z-[70] bg-[#05080C] text-white fl-fade-in">
      <div aria-hidden="true" className="absolute inset-0 opacity-60" style={{ backgroundImage: blend }} />
      <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: "linear-gradient(180deg, rgba(5,8,12,.85) 0%, rgba(5,8,12,.35) 30%, rgba(5,8,12,.35) 60%, rgba(5,8,12,.95) 100%)" }} />
      <div className="relative mx-auto flex h-full max-w-[600px] flex-col px-3 pt-[max(16px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
        {/* progress strip (one story per live game) */}
        <div className="flex gap-1 px-1" aria-hidden="true">
          <span className="h-[3px] flex-1 rounded-full" style={{ backgroundImage: blend }} />
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <span dir="rtl" className="flex shrink-0 items-center rounded-full bg-[#FAF9F6] px-1 py-1">
            <CrestDisc team={home} size={22} disc={false} />
            <CrestDisc team={away} size={22} disc={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{home?.name} – {away?.name}</span>
            {game?.venue && <span className="block truncate text-[12px] opacity-80">{game.venue}</span>}
          </span>
          {ended ? <span className="rounded-md bg-white/15 px-2 py-1 text-[11px] font-extrabold">סיום</span> : <LiveChip />}
          <button ref={closeRef} type="button" onClick={onClose} aria-label="סגירה" className="flex size-11 items-center justify-center rounded-full hover:bg-white/10">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* score band — home RIGHT */}
        <div dir="rtl" className="mt-3 flex min-h-[64px] items-center gap-2 rounded-[18px] px-3 py-2" style={{ backgroundImage: blend }}>
          <CrestDisc team={home} size={38} />
          <span className="min-w-0 flex-1 text-[13px] font-bold leading-tight line-clamp-2">{home?.name}</span>
          <span className="flex shrink-0 flex-col items-center gap-0.5 px-1">
            <FLScore home={live?.home_score ?? 0} away={live?.away_score ?? 0} size={30} />
            <span className="whitespace-nowrap text-[11px] opacity-85">
              {live?.period ? `${live.period} · ` : ""}<span dir="ltr" className="tabular-nums">{ended ? "" : clockString(remaining)}</span>
            </span>
          </span>
          <span className="min-w-0 flex-1 text-[13px] font-bold leading-tight text-left line-clamp-2">{away?.name}</span>
          <CrestDisc team={away} size={38} />
        </div>

        <div className="flex-1" />

        {events.length > 0 && (
          <ol aria-label="אירועים אחרונים" className="mb-4 flex flex-col items-start gap-1.5">
            {events.map((e, i) => {
              const team = e.side === "home" ? home : away
              return (
                <li key={e.id || i} className={`flex items-center gap-2 rounded-[14px] px-3 py-2 text-[13px] ${i === 0 ? "bg-[rgba(5,8,12,.62)]" : "bg-[rgba(5,8,12,.5)] opacity-85"}`}>
                  {e.timeMS != null && <span className={`fl-num text-[16px] ${i === 0 ? "text-fl-accent" : ""}`} dir="ltr">{clockString(e.timeMS)}</span>}
                  <CrestDisc team={team} size={22} />
                  {e.type === "goal"
                    ? <span className="inline-flex items-center gap-1"><Ball className="h-4 w-4" /><b>שער!</b> {e.ownGoal ? "שער עצמי" : e.player || ""}</span>
                    : <span className="inline-flex items-center gap-1.5"><span className={`inline-block h-3.5 w-2.5 rounded-[2px] ${e.type === "red" ? "bg-fl-red" : "bg-fl-blue"}`} />{e.type === "red" ? "כרטיס אדום" : "כרטיס כחול"} {e.player || ""}</span>}
                </li>
              )
            })}
          </ol>
        )}

        <Link to={entityPath("games", game || live?.game_id)} onClick={onClose}
          className="flex h-12 items-center justify-center rounded-full bg-white text-[14px] font-bold text-[#11161D]">
          לעמוד המשחק
        </Link>
      </div>
    </div>
  )
}
