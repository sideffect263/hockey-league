import { useState, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { getGameById, getTeams, getPlayers } from "@/lib/api"
import { ArrowRight, Calendar, Clock, MapPin, RefreshCw, Gavel } from "lucide-react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import JudgeGate from "@/components/judge/JudgeGate"
import GameScoreboard from "@/components/judge/GameScoreboard"
import { JudgeGameSkeleton } from "@/components/skeletons/PageSkeletons"

const statusCfg = {
  scheduled: { label: "מתוכנן", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  in_progress: { label: "משחק חי", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  waiting_result: { label: "ממתין לתוצאה", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  completed: { label: "הסתיים", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400" },
}

function JudgeGameView() {
  const { id } = useParams()
  const [game, setGame] = useState(null)
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { loadData() }, [id])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [g, t, p] = await Promise.all([getGameById(id), getTeams(), getPlayers()])
      setGame(g); setTeams(t); setPlayers(p)
    } catch (e) { console.error(e); setError("שגיאה בטעינת המשחק") }
    finally { setLoading(false) }
  }

  if (loading) return <JudgeGameSkeleton />

  if (error || !game) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error || "המשחק לא נמצא"}</span>
          <div className="flex gap-2">
            <button onClick={loadData} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
            </button>
            <Link to="/judge" className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition-colors">
              <ArrowRight className="w-3.5 h-3.5" /> חזרה
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const home = teamsMap[game.home_team_id]
  const away = teamsMap[game.away_team_id]
  const st = statusCfg[game.status] || statusCfg.scheduled
  const hasScore = game.home_score != null && game.away_score != null

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <Link to="/judge" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
        <ArrowRight className="w-4 h-4" /> חזרה לרשימת המשחקים
      </Link>

      {/* Match header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center gap-1.5 text-xs font-bold text-brand dark:text-brand-light"><Gavel className="w-3.5 h-3.5" /> לוח שיפוט</span>
          <span className={`stat-pill ${st.cls} mr-auto`}>{st.label}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <TeamLogo team={home} size={14} />
            <span className="font-bold text-sm text-slate-900 dark:text-white text-center truncate w-full">{home?.name || '—'}</span>
            <span className="text-[11px] text-slate-400">בית</span>
          </div>
          <div className="shrink-0 text-center px-2">
            {hasScore ? (
              /* RTL: away_score first, home_score last (see rtl-score-gotcha) */
              <div className="text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">
                <span>{game.away_score}</span><span className="text-slate-300 dark:text-slate-600 mx-1.5">:</span><span>{game.home_score}</span>
              </div>
            ) : (
              <div className="text-xl font-bold text-slate-300 dark:text-slate-600">{format(new Date(game.game_date), "HH:mm")}</div>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
            <TeamLogo team={away} size={14} />
            <span className="font-bold text-sm text-slate-900 dark:text-white text-center truncate w-full">{away?.name || '—'}</span>
            <span className="text-[11px] text-slate-400">חוץ</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/50 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{format(new Date(game.game_date), "d/M/yyyy")}</span>
          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{format(new Date(game.game_date), "HH:mm")}</span>
          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{game.venue || '—'}</span>
        </div>
      </motion.div>

      {/* Live scoring board (full game engine) */}
      <GameScoreboard game={game} home={home} guest={away} players={players} />
    </div>
  )
}

export default function JudgeGame() {
  return <JudgeGate skeleton={<JudgeGameSkeleton />}><JudgeGameView /></JudgeGate>
}
