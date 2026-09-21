import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getPendingGameChangeRequests, finalizeGameChange, rejectGameChange } from "@/lib/gameRequests"
import { Check, X, CalendarClock, RefreshCw, MapPin, ExternalLink, ArrowLeft } from "lucide-react"
import { format } from "date-fns"
import { entityPath } from "@/lib/slugs"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * League-manager / admin FINALIZATION queue (#5). These requests already cleared the
 * opponent coach (or the opponent team had no coach). The manager picks ONE of the
 * agreed dates; finalize_game_change atomically applies date + venue to the game.
 */
export default function GameChangeRequestsReview({ teamsMap = {} }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [chosen, setChosen] = useState({}) // request id -> chosen ISO date

  const load = async () => {
    try { setLoading(true); setError(null); setItems(await getPendingGameChangeRequests()) }
    catch { setError("שגיאה בטעינת הבקשות") } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const teamName = (id) => teamsMap[id]?.name || "קבוצה"
  const fmt = (d) => (d ? format(new Date(d), "EEEE d/M/yyyy · HH:mm") : null)
  const dateOptions = (r) => (Array.isArray(r.opponent_dates) && r.opponent_dates.length
    ? r.opponent_dates : (Array.isArray(r.proposed_dates) ? r.proposed_dates : []))

  const finalize = async (r) => {
    const opts = dateOptions(r)
    if (opts.length > 0 && !chosen[r.id]) { setError("יש לבחור מועד סופי"); return }
    setBusyId(r.id); setError(null)
    try { await finalizeGameChange(r.id, opts.length ? chosen[r.id] : null); await load() }
    catch (e) { setError(e.message || "שגיאה באישור") } finally { setBusyId(null) }
  }
  const reject = async (r) => {
    setBusyId(r.id); setError(null)
    try { await rejectGameChange(r.id); await load() }
    catch (e) { setError(e.message || "שגיאה בדחייה") } finally { setBusyId(null) }
  }

  if (loading) return <SkeletonPanelRows />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><CalendarClock className="w-5 h-5 text-brand" /> בקשות לשינוי משחק</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">בחר/י מועד סופי; האישור מעדכן את המשחק אוטומטית</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><RefreshCw className="w-3.5 h-3.5" /> רענון</button>
      </div>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <CalendarClock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">אין בקשות הממתינות לאישור סופי</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((r) => {
            const g = r.games || {}
            const who = r.requester?.display_name || "מאמן"
            const opts = dateOptions(r)
            const busy = busyId === r.id
            return (
              <div key={r.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 dark:text-white">
                      <span className="font-bold">{who}</span>
                      <span className="text-slate-500 dark:text-slate-400"> ({teamName(r.team_id)}) מבקש/ת לשנות</span>
                    </p>
                    <Link to={entityPath('games', r.game_id)} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-brand transition-colors mt-0.5">
                      {teamName(g.home_team_id)} <span className="text-slate-400">נגד</span> {teamName(g.away_team_id)}
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </Link>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">{fmt(r.created_at)}</span>
                </div>

                {r.reason && <p className="text-sm text-slate-600 dark:text-slate-300 italic">"{r.reason}"</p>}

                {opts.length > 0 && (
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">בחר/י מועד סופי {Array.isArray(r.opponent_dates) && r.opponent_dates.length ? "(סוכם עם היריב)" : ""}:</p>
                    {opts.map(d => (
                      <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" name={`d-${r.id}`} checked={chosen[r.id] === d} onChange={() => setChosen(c => ({ ...c, [r.id]: d }))} className="accent-emerald-500" />
                        <span className="text-slate-800 dark:text-slate-200">{fmt(d)}</span>
                      </label>
                    ))}
                  </div>
                )}

                {r.proposed_venue && (
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-slate-400 line-through">{g.venue || r.original_venue || "—"}</span>
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-bold text-slate-900 dark:text-white">{r.proposed_venue}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button onClick={() => finalize(r)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> אישור והחלה
                  </button>
                  <button onClick={() => reject(r)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> דחייה
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
