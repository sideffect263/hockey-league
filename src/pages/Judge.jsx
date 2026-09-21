import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getGames, getTeams, getPlayers } from "@/lib/api"
import { getAvailabilityForOfficialBatch } from "@/lib/availability"
import { getMyApprovedGameIds } from "@/lib/officials"
import { useAuth } from "@/lib/AuthContext"
import { Gavel, Calendar, MapPin, RefreshCw, ChevronLeft, Clock, Users, AlertTriangle } from "lucide-react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import JudgeGate from "@/components/judge/JudgeGate"
import { JudgeSkeleton } from "@/components/skeletons/PageSkeletons"

const OFFICIABLE = ["scheduled", "in_progress", "waiting_result"]
const statusCfg = {
  scheduled: { label: "מתוכנן", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  in_progress: { label: "משחק חי", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  waiting_result: { label: "ממתין לתוצאה", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
}

function JudgePicker() {
  const { isAdmin } = useAuth()
  const [games, setGames] = useState([])
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [availByGame, setAvailByGame] = useState({})
  // Games this judge was APPROVED for. Previously every judge saw every fixture.
  const [myGameIds, setMyGameIds] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [g, t, p, mine] = await Promise.all([
        getGames(), getTeams(), getPlayers(), getMyApprovedGameIds('judge'),
      ])
      setGames(g); setTeams(t); setPlayers(p); setMyGameIds(mine)
      const upcomingIds = g.filter(x => OFFICIABLE.includes(x.status)).map(x => x.id)
      const rows = await getAvailabilityForOfficialBatch(upcomingIds)
      const map = {}
      rows.forEach(r => { (map[r.game_id] ||= {})[r.player_id] = r.status })
      setAvailByGame(map)
    } catch (e) { console.error(e); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  if (loading) return <JudgeSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <button onClick={loadData} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  // A judge sees only the games he was approved for; an admin still sees everything.
  // myGameIds === null means the assignments are still loading — show nothing rather
  // than briefly flashing the full fixture list.
  const officiable = games
    .filter(g => OFFICIABLE.includes(g.status))
    .filter(g => isAdmin || (myGameIds ? myGameIds.has(g.id) : false))
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))

  // C3: attendance readiness per team, for the referee's upcoming games.
  const teamAtt = (game, tid) => {
    const avail = availByGame[game.id] || {}
    const coming = players.filter(p => p.team_id === tid && avail[p.id] === "available")
    return { count: coming.length, gk: coming.some(p => p.position === "Goalkeeper"), tooFew: coming.length < 4 }
  }
  const AttChip = ({ att }) => (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${att.tooFew ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
      <Users className="w-3 h-3" /> {att.count}{!att.gk && <AlertTriangle className="w-3 h-3 text-red-500" />}
    </span>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <Gavel className="w-7 h-7 text-brand" /> שיפוט משחקים
        </h1>
        <p className="page-subtitle mt-1">בחר/י משחק כדי לנהל תוצאה וסטטיסטיקות בזמן אמת</p>
      </motion.div>

      {officiable.length === 0 ? (
        <div className="card p-10 text-center">
          <Calendar className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">אין משחקים זמינים לשיפוט</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">משחקים מתוכננים או פעילים יופיעו כאן</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {officiable.map((game, i) => {
            const home = teamsMap[game.home_team_id]
            const away = teamsMap[game.away_team_id]
            const st = statusCfg[game.status] || statusCfg.scheduled
            return (
              <motion.div key={game.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
                <Link to={`/judge/${game.id}`} className="card-hover p-4 sm:p-5 block">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`stat-pill ${st.cls}`}>{st.label}</span>
                    {game.game_type && game.game_type !== 'ליגה' && (
                      <span className="stat-pill bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">{game.game_type}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <TeamLogo team={home} size={10} />
                      <span className="font-bold text-sm text-slate-900 dark:text-white truncate">{home?.name || '—'}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">נגד</span>
                    <div className="flex items-center gap-2.5 flex-1 min-w-0 flex-row-reverse">
                      <TeamLogo team={away} size={10} />
                      <span className="font-bold text-sm text-slate-900 dark:text-white truncate text-left">{away?.name || '—'}</span>
                    </div>
                  </div>
                  {game.status === "scheduled" && (
                    <div className="flex items-center justify-between gap-2 mt-2.5">
                      <AttChip att={teamAtt(game, game.home_team_id)} />
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">מגיעים</span>
                      <AttChip att={teamAtt(game, game.away_team_id)} />
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{format(new Date(game.game_date), "d/M/yyyy")}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{format(new Date(game.game_date), "HH:mm")}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{game.venue || '—'}</span>
                    <span className="mr-auto flex items-center gap-1 font-semibold text-brand dark:text-brand-light">
                      פתח לוח שיפוט <ChevronLeft className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Judge() {
  return <JudgeGate skeleton={<JudgeSkeleton />}><JudgePicker /></JudgeGate>
}
