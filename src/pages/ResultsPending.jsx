import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { format } from "date-fns"
import { ChevronLeft, RefreshCw } from "lucide-react"
import { ApprovedStatus as CheckCircle2, BrandTile } from "@/components/icons/BrandIcons"
import { getGames, getTeams } from "@/lib/api"
import { useAuth } from "@/lib/AuthContext"
import TeamLogo from "@/components/TeamLogo"
import { JudgeSkeleton } from "@/components/skeletons/PageSkeletons"
import { canEnterResults, getOpenSubmissionStatuses } from "@/lib/gameFormResult"
import { ilDate } from "@/lib/ilTime"

/**
 * /results — games that have been played (kick-off passed) but have no result yet.
 * For referees and league managers: this is where a game played without the game clock
 * waits until someone uploads its form. Each row opens /games/:id/result.
 */

const SUB_LABEL = {
  uploaded: { text: "נשלח לקריאה", cls: "badge-info" },
  analyzing: { text: "בקריאה…", cls: "badge-info" },
  analyzed: { text: "מוכן לבדיקה", cls: "badge-success" },
  failed: { text: "הקריאה נכשלה", cls: "badge-danger" },
}

export default function ResultsPending() {
  const auth = useAuth()
  const allowed = canEnterResults(auth)
  const [rows, setRows] = useState(null)
  const [teams, setTeams] = useState({})
  const [subs, setSubs] = useState({})
  const [error, setError] = useState(null)

  const load = async () => {
    setError(null)
    try {
      const [g, t] = await Promise.all([getGames(), getTeams()])
      const now = Date.now()
      const waiting = (g || [])
        .filter(x => ["scheduled", "waiting_result", "in_progress"].includes(x.status) && new Date(x.game_date).getTime() < now)
        .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
      setTeams(Object.fromEntries((t || []).map(x => [x.id, x])))
      setSubs(await getOpenSubmissionStatuses(waiting.map(x => x.id)))
      setRows(waiting)
    } catch (e) { console.error(e); setError("שגיאה בטעינת המשחקים") }
  }
  useEffect(() => { if (allowed) load() }, [allowed])

  if (auth.loading || (allowed && !rows && !error)) return <JudgeSkeleton />

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="page-title flex items-center gap-2.5"><BrandTile name="game-form" className="w-10 h-10 -my-1.5" /> הזנת תוצאות</h1>
        <p className="page-subtitle mt-1">משחקים ששוחקו ועוד אין להם תוצאה — צלמו את טופס השיפוט והמערכת תמלא את הנתונים</p>
      </div>

      {!allowed ? (
        <div className="card p-6 text-center text-sm text-fg-muted">העמוד פתוח לשופטים ולמנהלי הליגה בלבד.</div>
      ) : error ? (
        <div className="card p-6 text-center space-y-3">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={load} className="btn-secondary btn-sm"><RefreshCw className="w-3.5 h-3.5" /> נסה שוב</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 mb-2" />
          <p className="text-sm font-medium text-fg-strong">כל המשחקים שהתקיימו כבר עם תוצאה</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map(g => {
            const home = teams[g.home_team_id], away = teams[g.away_team_id]
            const sub = SUB_LABEL[subs[g.id]]
            return (
              <Link key={g.id} to={`/games/${g.id}/result`} className="card-hover p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-fg-muted">
                    <span dir="ltr" className="tabular-nums">{format(ilDate(g.game_date), "dd.MM.yyyy HH:mm")}</span>
                    {g.venue && <span>· {g.venue}</span>}
                    {g.game_type && g.game_type !== "ליגה" && <span className="stat-pill badge-accent !py-0">{g.game_type}</span>}
                    {sub && <span className={`stat-pill !py-0 ${sub.cls}`}>{sub.text}</span>}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <TeamLogo team={home} size={8} />
                    <span className="font-bold text-sm text-fg-strong truncate">{home?.name}</span>
                    <span className="text-xs text-fg-muted">נגד</span>
                    <TeamLogo team={away} size={8} />
                    <span className="font-bold text-sm text-fg-strong truncate">{away?.name}</span>
                  </div>
                </div>
                <ChevronLeft className="w-5 h-5 text-fg-muted shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
