import { useEffect, useState } from "react"
import { ClipboardIcon as ClipboardList } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { PlayerLink } from "@/components/EntityLinks"
import { getPublicAttendance } from "@/lib/availability"

/**
 * Each side's squad for a played game — everyone who signed up "מגיע" (including a
 * player a coach added on loan, whose sign-up carries the side he played for).
 * The box score only lists scorers and carded players, so without this the page
 * forgets who actually took part once the game is over. Signed-in viewers only,
 * same as the sign-up list before the game (game_attendance refuses anonymous callers).
 */
export default function GameSquads({ game, teamsMap, playersMap }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let alive = true
    getPublicAttendance(game.id).then(r => { if (alive) setRows(r) }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [game.id])

  if (!rows) return null
  const sides = [game.home_team_id, game.away_team_id]
  const bySide = Object.fromEntries(sides.map(tid => [tid, []]))
  for (const r of rows) {
    if (r.status !== "available") continue
    const p = playersMap[r.player_id]
    if (!p) continue
    const tid = sides.includes(r.team_id) ? r.team_id : p.team_id
    if (!bySide[tid]) continue
    bySide[tid].push({ p, loanFrom: tid !== p.team_id ? teamsMap[p.team_id] : null })
  }
  if (sides.every(tid => bySide[tid].length === 0)) return null
  const sortKey = ({ p }) => `${p.position === "Goalkeeper" ? 0 : 1}${p.first_name} ${p.last_name}`
  for (const tid of sides) bySide[tid].sort((a, b) => sortKey(a).localeCompare(sortKey(b), "he"))

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="flex items-center gap-2 text-[20px] font-extrabold leading-tight text-fg-strong">
          <ClipboardList className="w-4 h-4 text-brand" /> סגל המשחק
        </h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">השחקנים שאישרו הגעה למשחק</p>
      </div>
      <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
        {sides.map(tid => (
          <div key={tid}>
            <div className="flex items-center gap-2 mb-2.5">
              <TeamLogo team={teamsMap[tid]} size={6} />
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 truncate">
                {teamsMap[tid]?.name || "—"} <span className="font-normal">({bySide[tid].length})</span>
              </h3>
            </div>
            {bySide[tid].length === 0
              ? <p className="text-xs text-slate-500 dark:text-slate-400 py-1">לא נרשמו שחקנים</p>
              : (
                <ul className="space-y-0.5">
                  {bySide[tid].map(({ p, loanFrom }) => (
                    <li key={p.id} className="flex items-center gap-2 py-1 px-2 text-sm text-slate-700 dark:text-slate-300 min-w-0">
                      <span className="w-6 text-xs text-slate-400 tabular-nums shrink-0" dir="ltr">{p.jersey_number ?? ""}</span>
                      <PlayerLink playerId={p.id} className="truncate min-w-0 hover:text-brand transition-colors">
                        {p.first_name} {p.last_name}
                        {p.position === "Goalkeeper" && <span className="text-xs text-slate-400"> (שוער)</span>}
                        {loanFrom && <span className="text-xs text-slate-400"> (בהשאלה מ{loanFrom.name})</span>}
                      </PlayerLink>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        ))}
      </div>
    </div>
  )
}
