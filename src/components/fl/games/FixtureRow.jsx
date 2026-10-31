/**
 * A fixture row (Games board; iOS FLFixtureRow): the whole row opens the game page; home
 * on the RIGHT, the time (or score / LIVE / struck time when postponed) in the middle, a
 * soft wash of the two teams' colours behind (away LEFT, home RIGHT). `onDark` = the
 * next-game-day card: crests in discs, white text, a stronger wash. Tags under the row
 * (your answer, coach attendance, playoff/friendly, waiting for a result) and an optional
 * `extra` block (the finished game's scorers) stay inside the same card.
 */
import { Link } from "react-router-dom"
import { CrestDisc, FLScore } from "@/components/fl/Floodlight"
import { teamIsLight, teamTint } from "@/lib/flTeam"
import { entityPath } from "@/lib/slugs"
import { timeOf, dayMonth, weekday } from "./flGamesKit"

const swatch = (t) => (teamIsLight(t) ? "#A3A3A3" : teamTint(t))
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || "")
  if (!m) return `rgba(128,128,128,${a})`
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`
}

export function fixtureWash(home, away, onDark) {
  const h = swatch(home), a = swatch(away)
  if (onDark) {
    return `linear-gradient(90deg, ${rgba(a, teamIsLight(away) ? 0.5 : 0.9)} 0%, ${rgba(a, 0.2)} 40%, ${rgba(h, 0.2)} 60%, ${rgba(h, teamIsLight(home) ? 0.5 : 0.9)} 100%)`
  }
  return `linear-gradient(90deg, ${rgba(a, 0.18)} 0%, ${rgba(a, 0)} 38%, ${rgba(h, 0)} 62%, ${rgba(h, 0.18)} 100%)`
}

function Side({ team, onDark, crestOuter }) {
  return (
    <span dir="rtl" className={`flex items-center gap-2 min-w-0 ${crestOuter ? "" : "flex-row-reverse"}`}>
      <CrestDisc team={team} size={onDark ? 36 : 32} className="shrink-0" />
      <span className={`min-w-0 text-[12.5px] min-[400px]:text-[14px] leading-tight break-words ${crestOuter ? "text-right" : "text-left"} ${onDark ? "font-bold text-white" : "font-semibold text-fg-strong"}`}>
        {team?.name || "—"}
      </span>
    </span>
  )
}

export default function FixtureRow({ game, home, away, live, onDark = false, tags = [], extra = null }) {
  const done = game.status === "completed" && game.home_score != null && game.away_score != null
  const isLive = !!live || game.status === "in_progress"
  const postponed = game.status === "postponed"
  const ink = onDark ? "text-white" : "text-fg-strong"
  const label = `${home?.name || "בית"} נגד ${away?.name || "חוץ"}, ${done ? `תוצאה ${game.home_score} ${game.away_score}` : `${weekday(game.game_date)} ${dayMonth(game.game_date)} ${timeOf(game.game_date)}`}${postponed ? ", נדחה" : ""}${isLive ? ", בשידור חי" : ""}`

  return (
    <Link to={entityPath("games", game)} aria-label={label}
      className={`block rounded-[16px] overflow-hidden transition-[filter] hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-fl-accent ${onDark ? "" : "bg-surface"} ${isLive ? "ring-[1.5px] ring-fl-live/60" : ""}`}
      style={{ backgroundImage: fixtureWash(home, away, onDark) }}>
      <span className={`flex flex-col gap-1 px-3 py-2 ${onDark ? "min-h-[72px]" : "min-h-16"} justify-center`}>
        {/* Physical left → right: away, centre, home. */}
        <span dir="ltr" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
          <Side team={away} onDark={onDark} crestOuter={false} />
          <span dir="rtl" className={`flex flex-col items-center min-w-[4.5rem] ${ink}`}>
            {isLive ? (
              <>
                {live && <FLScore home={live.home_score ?? 0} away={live.away_score ?? 0} size={22} />}
                <span className="text-[10px] font-extrabold text-white bg-fl-live rounded-[5px] px-1.5 py-0.5 mt-0.5">LIVE</span>
              </>
            ) : done ? (
              <FLScore home={game.home_score} away={game.away_score} size={24} />
            ) : postponed ? (
              <>
                <span dir="ltr" className="fl-num text-[18px] line-through opacity-55">{timeOf(game.game_date)}</span>
                <span className="text-[11px] font-bold text-fl-live">נדחה</span>
              </>
            ) : (
              <span dir="ltr" className={`fl-num ${onDark ? "text-[22px] min-[400px]:text-[26px]" : "text-[20px] min-[400px]:text-[22px]"}`}>{timeOf(game.game_date)}</span>
            )}
          </span>
          <Side team={home} onDark={onDark} crestOuter />
        </span>
        {tags.length > 0 && (
          <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
            {tags.map((t, i) => (
              <span key={i} className={`inline-flex items-center gap-1 text-[11.5px] font-bold ${onDark ? "text-white" : t.tone || "text-fg-muted"}`}>{t.icon}{t.text}</span>
            ))}
          </span>
        )}
        {extra}
      </span>
    </Link>
  )
}

/** "21.11" big italic + "שבת · מחזור 4" + the day's rinks (Games board day header). */
export function DayHeader({ date, games, round, size = 40, onDark = false, trailing }) {
  const venues = [...new Set(games.map(g => g.venue?.trim()).filter(Boolean))].join(" · ")
  return (
    <div className={`flex items-end gap-3 ${onDark ? "text-white" : "text-fg-strong"}`}>
      <span dir="ltr" className={"fl-num leading-none shrink-0 " + (size >= 56 ? "text-[44px] min-[400px]:text-[56px]" : "text-[36px] min-[400px]:text-[40px]")}>{dayMonth(date)}</span>
      <span className="flex flex-col gap-0.5 pb-[3px] min-w-0">
        <span className={`font-bold whitespace-nowrap ${onDark ? "text-[14px] min-[400px]:text-[15px]" : "text-[14px]"}`}>{weekday(date)}{round ? ` · מחזור ${round}` : ""}</span>
        {venues && <span className={`text-[12px] truncate ${onDark ? "text-white/70" : "text-fg-muted"}`}>{venues}</span>}
      </span>
      <span className="flex-1" />
      {trailing && <span className="text-[12px] font-bold text-fl-accent pb-1.5 whitespace-nowrap">{trailing}</span>}
    </div>
  )
}
