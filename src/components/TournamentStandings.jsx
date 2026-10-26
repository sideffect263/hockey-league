import { standingsComparator } from "@/lib/utils"
import TeamLogo from "@/components/TeamLogo"
import { TeamLink } from "@/components/EntityLinks"
import { Trophy } from "@/components/icons/BrandIcons"

// Tournament standings from completed games (win=3, tie=1 — matches the league's
// server-side recompute). Seeds all participants so teams with 0 games still show.
function computeStandings(teamIds, games, teamsMap) {
  const rows = {}
  const row = (tid) => {
    if (!rows[tid]) rows[tid] = { id: tid, team: teamsMap[tid], p: 0, wins: 0, ties: 0, losses: 0, goals_for: 0, goals_against: 0, points: 0 }
    return rows[tid]
  }
  teamIds.forEach(row)
  for (const g of games) {
    if (g.status !== 'completed' || g.home_score == null || g.away_score == null) continue
    const h = row(g.home_team_id), a = row(g.away_team_id)
    h.p++; a.p++
    h.goals_for += g.home_score; h.goals_against += g.away_score
    a.goals_for += g.away_score; a.goals_against += g.home_score
    if (g.home_score > g.away_score) { h.wins++; a.losses++ }
    else if (g.away_score > g.home_score) { a.wins++; h.losses++ }
    else { h.ties++; a.ties++ }
  }
  const list = Object.values(rows)
  list.forEach(r => { r.points = r.wins * 3 + r.ties })
  return list.sort(standingsComparator)
}

export default function TournamentStandings({ teamIds = [], games = [], teamsMap = {} }) {
  if (teamIds.length < 2) return null
  const playedAny = games.some(g => g.status === 'completed' && g.home_score != null && g.away_score != null)
  const standings = computeStandings(teamIds, games, teamsMap)

  return (
    <div className="card p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-3">
        <Trophy className="w-4 h-4 text-brand" /> טבלת הטורניר
      </h2>
      {!playedAny ? (
        <p className="text-sm text-slate-400 text-center py-4">הטבלה תתעדכן לאחר המשחקים הראשונים</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
                <th className="text-right font-semibold py-2 pr-1">#</th>
                <th className="text-right font-semibold py-2">קבוצה</th>
                <th className="text-center font-semibold py-2 w-8">מש'</th>
                <th className="text-center font-semibold py-2 w-8">נ</th>
                <th className="text-center font-semibold py-2 w-8">ת</th>
                <th className="text-center font-semibold py-2 w-8">ה</th>
                <th className="text-center font-semibold py-2 w-14">שערים</th>
                <th className="text-center font-semibold py-2 w-8">הפרש</th>
                <th className="text-center font-bold py-2 w-10 text-slate-600 dark:text-slate-300">נק'</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((r, i) => {
                const gd = r.goals_for - r.goals_against
                const team = r.team || teamsMap[r.id]
                return (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                    <td className="py-2 pr-1 text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <TeamLogo team={team} size={6} />
                        <TeamLink team={team} className="font-semibold text-slate-800 dark:text-slate-200 truncate hover:text-brand transition-colors">{team?.name || "—"}</TeamLink>
                      </div>
                    </td>
                    <td className="text-center tabular-nums text-slate-500">{r.p}</td>
                    <td className="text-center tabular-nums text-emerald-600 dark:text-emerald-400">{r.wins}</td>
                    <td className="text-center tabular-nums text-slate-400">{r.ties}</td>
                    <td className="text-center tabular-nums text-red-500">{r.losses}</td>
                    <td className="text-center tabular-nums text-slate-500">{r.goals_for}:{r.goals_against}</td>
                    <td className="text-center tabular-nums text-slate-500">{gd > 0 ? `+${gd}` : gd}</td>
                    <td className="text-center tabular-nums font-extrabold text-slate-900 dark:text-white">{r.points}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
