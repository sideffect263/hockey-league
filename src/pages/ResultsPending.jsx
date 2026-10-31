import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { format } from "date-fns"
import { ChevronLeft, RefreshCw } from "lucide-react"
import { ApprovedStatus as CheckCircle2, BrandIcon } from "@/components/icons/BrandIcons"
import { getGames, getTeams } from "@/lib/api"
import { useAuth } from "@/lib/AuthContext"
import { CrestDisc } from "@/components/fl/Floodlight"
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
    <div className="px-4 py-5 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[34px] sm:text-[40px] font-extrabold leading-none text-fg-strong">הזנת תוצאות</h1>
          <p className="text-[14px] text-fg-muted mt-2">משחקים ששוחקו ועוד אין להם תוצאה · צלמו את טופס השיפוט והמערכת תמלא את הנתונים</p>
        </div>
        <BrandIcon name="game-form" variant="large" className="w-11 h-11 shrink-0" />
      </header>

      {!allowed ? (
        <div className="card p-6 text-center text-sm text-fg-muted">העמוד פתוח לשופטים ולמנהלי הליגה בלבד.</div>
      ) : error ? (
        <div className="card p-6 text-center space-y-3">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button onClick={load} className="btn-secondary min-h-[44px]"><RefreshCw className="w-4 h-4" /> נסה שוב</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2" />
          <p className="text-[15px] font-bold text-fg-strong">כל המשחקים שהתקיימו כבר עם תוצאה</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map(g => {
            const home = teams[g.home_team_id], away = teams[g.away_team_id]
            const st = subs[g.id]
            const sub = SUB_LABEL[st] || { text: "אין טופס", cls: "bg-surface-sunken text-fg-muted" }
            const cta = st === "analyzed" ? "לבדוק ולאשר" : st === "failed" ? "מילוי ידני" : (st === "uploaded" || st === "analyzing") ? "לפתוח" : "צילום הטופס"
            return (
              <Link key={g.id} to={`/games/${g.id}/result`} className="card-hover p-4 flex flex-col gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-fl-accent">
                {/* home on the RIGHT (first in RTL), away on the left */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <CrestDisc team={home} size={32} />
                    <span className="font-extrabold text-[14px] leading-tight text-fg-strong line-clamp-2">{home?.name}</span>
                  </span>
                  <span className="flex flex-col items-center text-[11px] text-fg-muted leading-tight">
                    <span dir="ltr" className="fl-num text-[13px] text-fg-strong">{format(ilDate(g.game_date), "d.M")}</span>
                    <span>{g.game_type && g.game_type !== "ליגה" ? g.game_type : "ליגה"}</span>
                  </span>
                  <span className="flex items-center gap-2 min-w-0 flex-row-reverse">
                    <CrestDisc team={away} size={32} />
                    <span className="font-extrabold text-[14px] leading-tight text-fg-strong line-clamp-2 text-left">{away?.name}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0 text-[12px] text-fg-muted">
                    <span className={`stat-pill !py-0.5 ${sub.cls}`}>{sub.text}</span>
                    <span dir="ltr" className="fl-num">{format(ilDate(g.game_date), "HH:mm")}</span>
                    {g.venue && <span className="truncate">· {g.venue}</span>}
                  </span>
                  <span className="shrink-0 inline-flex items-center gap-1 min-h-[40px] px-4 rounded-control bg-brand text-brand-fg text-[13px] font-extrabold">
                    {cta} <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
