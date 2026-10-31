import { useState, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { getGameById, getTeams, getPlayers } from "@/lib/api"
import { ArrowRight, RefreshCw } from "lucide-react"
import { Gavel } from "@/components/icons/BrandIcons"
import JudgeGate from "@/components/judge/JudgeGate"
import GameScoreboard from "@/components/judge/GameScoreboard"
import { JudgeGameSkeleton } from "@/components/skeletons/PageSkeletons"

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
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto">
        <div className="card p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <Gavel className="w-10 h-10 text-fg-muted" />
          <span className="text-fg-strong text-base font-bold">{error || "המשחק לא נמצא"}</span>
          <div className="flex gap-2">
            <button onClick={loadData} className="btn-primary min-h-[44px] inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> נסה שוב
            </button>
            <Link to="/judge" className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5">
              <ArrowRight className="w-4 h-4" aria-hidden="true" /> חזרה לרשימה
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const home = teamsMap[game.home_team_id]
  const away = teamsMap[game.away_team_id]

  // The board is the whole screen (the shell hides its header/tab bar on /judge/:id):
  // teams, crests, period and clock all live on it, so there is no page header here.
  return <GameScoreboard game={game} home={home} guest={away} players={players} teams={teams} />
}

export default function JudgeGame() {
  return <JudgeGate skeleton={<JudgeGameSkeleton />}><JudgeGameView /></JudgeGate>
}
